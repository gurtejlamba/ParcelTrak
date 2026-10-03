const express = require('express');
const { get, all, transaction } = require('../db/database');
const { requireRole } = require('../middleware/auth');
const { generateTrackingNumber } = require('../utils/tracking');
const { computeVolumetricWeight, computeChargeableWeight, getActiveTariff, generateInvoice } = require('../utils/billing');
const { appendScanEvent, STATUS_LABELS } = require('../utils/scanEvents');

const router = express.Router();
router.use(requireRole('SENDER'));

router.get('/', (req, res) => {
  const consignments = all(
    `SELECT c.*, i.status AS invoice_status, i.amount AS invoice_amount
     FROM consignments c
     LEFT JOIN invoices i ON i.consignment_id = c.id
     WHERE c.sender_id = ? ORDER BY c.id DESC`,
    [req.session.user.id]
  );
  res.render('sender/dashboard', { title: 'My Consignments', consignments, statusLabels: STATUS_LABELS });
});

router.get('/book', (req, res) => {
  const branches = all('SELECT * FROM branches WHERE is_active = 1 ORDER BY name');
  let tariff = null;
  try { tariff = getActiveTariff(); } catch (e) { /* surfaced in the view */ }
  res.render('sender/book', { title: 'Book a Consignment', branches, tariff, form: {}, errors: [] });
});

router.post('/book', (req, res) => {
  const branches = all('SELECT * FROM branches WHERE is_active = 1 ORDER BY name');
  const {
    recipientName, recipientPhone, recipientAddress,
    originBranchId, destBranchId, actualWeight, lengthCm, widthCm, heightCm,
  } = req.body;

  const errors = [];
  const weight = parseFloat(actualWeight);
  const l = parseFloat(lengthCm), w = parseFloat(widthCm), h = parseFloat(heightCm);

  if (!recipientName || !recipientPhone || !recipientAddress) errors.push('Recipient details are required.');
  if (!originBranchId || !destBranchId) errors.push('Origin and destination branches are required.');
  if (originBranchId === destBranchId) errors.push('Origin and destination branches must differ.');
  if (!(weight > 0)) errors.push('Actual weight must be a positive number.');
  if (!(l > 0) || !(w > 0) || !(h > 0)) errors.push('Dimensions must be positive numbers.');

  let tariff = null;
  try { tariff = getActiveTariff(); } catch (e) { errors.push(e.message); }

  if (errors.length) {
    return res.render('sender/book', {
      title: 'Book a Consignment', branches, tariff, errors,
      form: { recipientName, recipientPhone, recipientAddress, originBranchId, destBranchId, actualWeight, lengthCm, widthCm, heightCm },
    });
  }

  const volumetricWeight = computeVolumetricWeight(l, w, h, tariff.volumetric_divisor);
  const chargeableWeight = computeChargeableWeight(weight, volumetricWeight);
  const trackingNumber = generateTrackingNumber();

  const consignmentId = transaction(() => {
    const { run } = require('../db/database');
    const { lastInsertRowid } = run(
      `INSERT INTO consignments
        (tracking_number, sender_id, recipient_name, recipient_phone, recipient_address,
         origin_branch_id, dest_branch_id, actual_weight, length_cm, width_cm, height_cm,
         volumetric_weight, chargeable_weight, current_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BOOKED')`,
      [trackingNumber, req.session.user.id, recipientName.trim(), recipientPhone.trim(), recipientAddress.trim(),
        originBranchId, destBranchId, weight, l, w, h, volumetricWeight, chargeableWeight]
    );
    const id = lastInsertRowid;
    appendScanEvent({
      consignmentId: id,
      eventType: 'BOOKED',
      branchId: Number(originBranchId),
      remarks: 'Consignment booked by sender.',
      recordedBy: req.session.user.id,
    });
    generateInvoice(id, chargeableWeight);
    return id;
  });

  req.session.flash = { type: 'success', message: `Consignment booked. Tracking number: ${trackingNumber}` };
  res.redirect(`/sender/consignments/${consignmentId}`);
});

router.get('/consignments/:id', (req, res) => {
  const consignment = get(
    `SELECT c.*, ob.name AS origin_name, db.name AS dest_name
     FROM consignments c
     JOIN branches ob ON ob.id = c.origin_branch_id
     JOIN branches db ON db.id = c.dest_branch_id
     WHERE c.id = ? AND c.sender_id = ?`,
    [req.params.id, req.session.user.id]
  );
  if (!consignment) return res.status(404).render('errors/404', { title: 'Not Found' });

  const events = all(
    `SELECT se.*, b.name AS branch_name FROM scan_events se
     LEFT JOIN branches b ON b.id = se.branch_id
     WHERE se.consignment_id = ? ORDER BY se.id ASC`,
    [consignment.id]
  );
  const invoice = get('SELECT * FROM invoices WHERE consignment_id = ?', [consignment.id]);

  res.render('sender/consignment-detail', {
    title: `Consignment ${consignment.tracking_number}`,
    consignment, events, invoice, statusLabels: STATUS_LABELS,
  });
});

// REQ-1.2: cancel only if not yet dispatched (still in BOOKED state).
router.post('/consignments/:id/cancel', (req, res) => {
  const consignment = get('SELECT * FROM consignments WHERE id = ? AND sender_id = ?', [req.params.id, req.session.user.id]);
  if (!consignment) return res.status(404).render('errors/404', { title: 'Not Found' });

  if (consignment.current_status !== 'BOOKED') {
    req.session.flash = { type: 'error', message: 'This consignment has already been dispatched and can no longer be cancelled.' };
    return res.redirect(`/sender/consignments/${consignment.id}`);
  }

  appendScanEvent({
    consignmentId: consignment.id,
    eventType: 'CANCELLED',
    branchId: consignment.origin_branch_id,
    remarks: 'Cancelled by sender before dispatch.',
    recordedBy: req.session.user.id,
  });

  req.session.flash = { type: 'success', message: 'Consignment cancelled.' };
  res.redirect(`/sender/consignments/${consignment.id}`);
});

router.get('/invoices', (req, res) => {
  const invoices = all(
    `SELECT i.*, c.tracking_number, c.recipient_name, c.current_status AS consignment_status FROM invoices i
     JOIN consignments c ON c.id = i.consignment_id
     WHERE c.sender_id = ? ORDER BY i.id DESC`,
    [req.session.user.id]
  );
  res.render('sender/invoices', { title: 'My Invoices', invoices });
});

// REQ-5.1: payment status can be settled. Sender settles their own invoice (simulated payment).
router.post('/invoices/:id/pay', (req, res) => {
  const invoice = get(
    `SELECT i.*, c.current_status AS consignment_status FROM invoices i JOIN consignments c ON c.id = i.consignment_id
     WHERE i.id = ? AND c.sender_id = ?`,
    [req.params.id, req.session.user.id]
  );
  if (!invoice) return res.status(404).render('errors/404', { title: 'Not Found' });

  if (invoice.consignment_status === 'CANCELLED') {
    req.session.flash = { type: 'error', message: 'This consignment was cancelled; no payment is due.' };
  } else if (invoice.status === 'PAID') {
    req.session.flash = { type: 'error', message: 'This invoice has already been paid.' };
  } else {
    const { run } = require('../db/database');
    run(`UPDATE invoices SET status = 'PAID', paid_at = datetime('now') WHERE id = ?`, [invoice.id]);
    req.session.flash = { type: 'success', message: 'Payment recorded. Thank you!' };
  }
  res.redirect('/sender/invoices');
});

module.exports = router;
