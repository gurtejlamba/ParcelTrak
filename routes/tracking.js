const express = require('express');
const { get, all } = require('../db/database');
const { STATUS_LABELS } = require('../utils/scanEvents');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('public/home', { title: 'PARCELTRAK' });
});

router.get('/track', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q) return res.redirect(`/track/${encodeURIComponent(q)}`);
  res.render('public/track', { title: 'Track a Consignment', trackingNumber: '', result: null, notFound: false });
});

// REQ-2.2: display status and full event history for a valid tracking number. No auth required.
router.get('/track/:trackingNumber', (req, res) => {
  const trackingNumber = req.params.trackingNumber.trim().toUpperCase();
  const consignment = get(
    `SELECT c.*, ob.name AS origin_name, ob.code AS origin_code, db.name AS dest_name, db.code AS dest_code
     FROM consignments c
     JOIN branches ob ON ob.id = c.origin_branch_id
     JOIN branches db ON db.id = c.dest_branch_id
     WHERE c.tracking_number = ?`,
    [trackingNumber]
  );

  if (!consignment) {
    return res.render('public/track', { title: 'Track a Consignment', trackingNumber, result: null, notFound: true });
  }

  const events = all(
    `SELECT se.*, b.name AS branch_name FROM scan_events se
     LEFT JOIN branches b ON b.id = se.branch_id
     WHERE se.consignment_id = ? ORDER BY se.id ASC`,
    [consignment.id]
  );

  res.render('public/track', {
    title: `Tracking ${consignment.tracking_number}`,
    trackingNumber,
    notFound: false,
    result: { consignment, events, statusLabels: STATUS_LABELS },
  });
});

module.exports = router;
