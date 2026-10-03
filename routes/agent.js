const express = require('express');
const { get, all, run } = require('../db/database');
const { requireRole } = require('../middleware/auth');
const { appendScanEvent, STATUS_LABELS } = require('../utils/scanEvents');

const router = express.Router();
router.use(requireRole('AGENT'));

const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED', 'RETURNED'];

function activeAssignmentFor(consignmentId) {
  return get(
    `SELECT * FROM assignments WHERE consignment_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`,
    [consignmentId]
  );
}

// Viewing a consignment's detail/history should remain available to an agent after
// delivery (assignment COMPLETED) or after being reassigned away — only the in-flight
// actions (scan / deliver / fail) require a currently ACTIVE assignment.
function everAssignedTo(consignmentId, agentId) {
  return get(
    `SELECT * FROM assignments WHERE consignment_id = ? AND agent_id = ? ORDER BY id DESC LIMIT 1`,
    [consignmentId, agentId]
  );
}

router.get('/', (req, res) => {
  const consignments = all(
    `SELECT c.*, a.id AS assignment_id, a.status AS assignment_status
     FROM assignments a
     JOIN consignments c ON c.id = a.consignment_id
     WHERE a.agent_id = ? AND a.status = 'ACTIVE'
     ORDER BY c.id DESC`,
    [req.session.user.id]
  );
  res.render('agent/dashboard', { title: 'My Deliveries', consignments, statusLabels: STATUS_LABELS });
});

router.get('/consignments/:id', (req, res) => {
  const assignment = everAssignedTo(req.params.id, req.session.user.id);
  if (!assignment) {
    return res.status(404).render('errors/404', { title: 'Not Found' });
  }
  const consignment = get(
    `SELECT c.*, ob.name AS origin_name, db.name AS dest_name
     FROM consignments c
     JOIN branches ob ON ob.id = c.origin_branch_id
     JOIN branches db ON db.id = c.dest_branch_id
     WHERE c.id = ?`,
    [req.params.id]
  );
  const events = all(
    `SELECT se.*, b.name AS branch_name FROM scan_events se
     LEFT JOIN branches b ON b.id = se.branch_id
     WHERE se.consignment_id = ? ORDER BY se.id ASC`,
    [consignment.id]
  );
  const failedAttempts = events.filter((e) => e.event_type === 'DELIVERY_FAILED').length;

  res.render('agent/consignment-detail', {
    title: `Consignment ${consignment.tracking_number}`,
    consignment, events, failedAttempts, statusLabels: STATUS_LABELS,
    isTerminal: TERMINAL_STATUSES.includes(consignment.current_status) || assignment.status !== 'ACTIVE',
  });
});

// General movement scans an agent can log while a parcel is on their route.
router.post('/consignments/:id/scan', (req, res) => {
  const { eventType, remarks } = req.body;
  const allowed = ['PICKED_UP', 'OUT_FOR_DELIVERY'];
  const assignment = activeAssignmentFor(req.params.id);
  if (!assignment || assignment.agent_id !== req.session.user.id) {
    return res.status(404).render('errors/404', { title: 'Not Found' });
  }
  if (!allowed.includes(eventType)) {
    req.session.flash = { type: 'error', message: 'Invalid scan event type.' };
    return res.redirect(`/agent/consignments/${req.params.id}`);
  }

  appendScanEvent({
    consignmentId: Number(req.params.id),
    eventType,
    branchId: req.session.user.branch_id,
    remarks: remarks || null,
    recordedBy: req.session.user.id,
  });

  req.session.flash = { type: 'success', message: 'Scan event recorded.' };
  res.redirect(`/agent/consignments/${req.params.id}`);
});

// REQ-4.1: capture proof of delivery (receiver name, signature, timestamp).
router.get('/consignments/:id/deliver', (req, res) => {
  const assignment = activeAssignmentFor(req.params.id);
  if (!assignment || assignment.agent_id !== req.session.user.id) {
    return res.status(404).render('errors/404', { title: 'Not Found' });
  }
  const consignment = get('SELECT * FROM consignments WHERE id = ?', [req.params.id]);
  res.render('agent/deliver', { title: 'Capture Proof of Delivery', consignment, error: null });
});

router.post('/consignments/:id/deliver', (req, res) => {
  const assignment = activeAssignmentFor(req.params.id);
  if (!assignment || assignment.agent_id !== req.session.user.id) {
    return res.status(404).render('errors/404', { title: 'Not Found' });
  }
  const { receiverName, signatureData } = req.body;
  const consignment = get('SELECT * FROM consignments WHERE id = ?', [req.params.id]);

  if (!receiverName || !signatureData) {
    return res.render('agent/deliver', {
      title: 'Capture Proof of Delivery', consignment,
      error: 'Receiver name and signature are both required.',
    });
  }

  run(
    `INSERT INTO proof_of_delivery (consignment_id, receiver_name, signature_data, recorded_by)
     VALUES (?, ?, ?, ?)`,
    [consignment.id, receiverName.trim(), signatureData, req.session.user.id]
  );

  appendScanEvent({
    consignmentId: consignment.id,
    eventType: 'DELIVERED',
    branchId: consignment.dest_branch_id,
    remarks: `Delivered to ${receiverName.trim()}.`,
    recordedBy: req.session.user.id,
  });

  run(`UPDATE assignments SET status = 'COMPLETED' WHERE id = ?`, [assignment.id]);

  req.session.flash = { type: 'success', message: 'Delivery confirmed and proof of delivery recorded.' };
  res.redirect(`/agent/consignments/${consignment.id}`);
});

// REQ-4.2: record a failed delivery attempt, returning the consignment to the re-attempt cycle.
router.post('/consignments/:id/fail', (req, res) => {
  const assignment = activeAssignmentFor(req.params.id);
  if (!assignment || assignment.agent_id !== req.session.user.id) {
    return res.status(404).render('errors/404', { title: 'Not Found' });
  }
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    req.session.flash = { type: 'error', message: 'A reason is required to log a failed delivery attempt.' };
    return res.redirect(`/agent/consignments/${req.params.id}`);
  }

  const consignment = get('SELECT * FROM consignments WHERE id = ?', [req.params.id]);
  appendScanEvent({
    consignmentId: consignment.id,
    eventType: 'DELIVERY_FAILED',
    branchId: consignment.dest_branch_id,
    remarks: reason.trim(),
    recordedBy: req.session.user.id,
  });
  // Assignment stays ACTIVE so the agent can re-attempt delivery.

  req.session.flash = { type: 'success', message: 'Failed delivery attempt logged. The consignment returns to the re-attempt cycle.' };
  res.redirect(`/agent/consignments/${req.params.id}`);
});

module.exports = router;
