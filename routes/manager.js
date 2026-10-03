const express = require('express');
const { get, all, run, transaction } = require('../db/database');
const { requireRole } = require('../middleware/auth');
const { appendScanEvent, STATUS_LABELS } = require('../utils/scanEvents');

const router = express.Router();
router.use(requireRole('MANAGER'));

function myBranchId(req) {
  return req.session.user.branch_id;
}

router.get('/', (req, res) => {
  const branchId = myBranchId(req);
  const branch = get('SELECT * FROM branches WHERE id = ?', [branchId]);

  const unassigned = all(
    `SELECT c.* FROM consignments c
     WHERE c.origin_branch_id = ?
       AND c.current_status = 'BOOKED'
       AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.consignment_id = c.id AND a.status = 'ACTIVE')
     ORDER BY c.id ASC`,
    [branchId]
  );

  const active = all(
    `SELECT c.*, u.name AS agent_name, a.id AS assignment_id
     FROM assignments a
     JOIN consignments c ON c.id = a.consignment_id
     JOIN users u ON u.id = a.agent_id
     WHERE a.status = 'ACTIVE' AND (c.origin_branch_id = ? OR c.dest_branch_id = ?)
     ORDER BY c.id DESC`,
    [branchId, branchId]
  );

  const stats = get(
    `SELECT
       (SELECT COUNT(*) FROM consignments WHERE origin_branch_id = ?) AS total_booked,
       (SELECT COUNT(*) FROM consignments WHERE origin_branch_id = ? AND current_status = 'DELIVERED') AS delivered,
       (SELECT COUNT(*) FROM consignments WHERE origin_branch_id = ? AND current_status = 'DELIVERY_FAILED') AS failed`,
    [branchId, branchId, branchId]
  );

  res.render('manager/dashboard', { title: 'Branch Dashboard', branch, unassigned, active, stats, statusLabels: STATUS_LABELS });
});

router.get('/assign', (req, res) => {
  const branchId = myBranchId(req);
  const consignments = all(
    `SELECT c.*, a.id AS assignment_id, a.agent_id AS current_agent_id, u.name AS current_agent_name
     FROM consignments c
     LEFT JOIN assignments a ON a.consignment_id = c.id AND a.status = 'ACTIVE'
     LEFT JOIN users u ON u.id = a.agent_id
     WHERE (c.origin_branch_id = ? OR c.dest_branch_id = ?)
       AND c.current_status NOT IN ('CANCELLED','DELIVERED','RETURNED')
     ORDER BY c.id DESC`,
    [branchId, branchId]
  );
  const agents = all(`SELECT * FROM users WHERE role = 'AGENT' AND branch_id = ? AND is_active = 1 ORDER BY name`, [branchId]);

  res.render('manager/assign', { title: 'Assign Consignments', consignments, agents });
});

// REQ-3.1 / REQ-3.2: assign, and reassign before delivery is completed.
router.post('/consignments/:id/assign', (req, res) => {
  const branchId = myBranchId(req);
  const { agentId } = req.body;
  const consignment = get(
    `SELECT * FROM consignments WHERE id = ? AND (origin_branch_id = ? OR dest_branch_id = ?)`,
    [req.params.id, branchId, branchId]
  );
  if (!consignment) return res.status(404).render('errors/404', { title: 'Not Found' });

  const agent = get(`SELECT * FROM users WHERE id = ? AND role = 'AGENT' AND branch_id = ? AND is_active = 1`, [agentId, branchId]);
  if (!agent) {
    req.session.flash = { type: 'error', message: 'Select a valid, active delivery agent from your branch.' };
    return res.redirect('/manager/assign');
  }

  const existing = get(`SELECT * FROM assignments WHERE consignment_id = ? AND status = 'ACTIVE'`, [consignment.id]);
  if (existing && existing.status === 'ACTIVE') {
    const completedCheck = get(`SELECT current_status FROM consignments WHERE id = ?`, [consignment.id]);
    if (completedCheck.current_status === 'DELIVERED') {
      req.session.flash = { type: 'error', message: 'This consignment has already been delivered and cannot be reassigned.' };
      return res.redirect('/manager/assign');
    }
  }

  transaction(() => {
    if (existing) {
      run(`UPDATE assignments SET status = 'REASSIGNED' WHERE id = ?`, [existing.id]);
    }
    run(
      `INSERT INTO assignments (consignment_id, agent_id, assigned_by, status) VALUES (?, ?, ?, 'ACTIVE')`,
      [consignment.id, agent.id, req.session.user.id]
    );
  });

  req.session.flash = {
    type: 'success',
    message: existing ? `Reassigned to ${agent.name}.` : `Assigned to ${agent.name}.`,
  };
  res.redirect('/manager/assign');
});

// REQ-6.1: record branch handover (incoming/outgoing) for a consignment.
router.get('/handover', (req, res) => {
  const branchId = myBranchId(req);
  const consignments = all(
    `SELECT * FROM consignments WHERE (origin_branch_id = ? OR dest_branch_id = ?)
       AND current_status NOT IN ('CANCELLED','DELIVERED','RETURNED')
     ORDER BY id DESC`,
    [branchId, branchId]
  );
  const recent = all(
    `SELECT h.*, c.tracking_number, u.name AS handled_by_name
     FROM branch_handovers h
     JOIN consignments c ON c.id = h.consignment_id
     JOIN users u ON u.id = h.handled_by
     WHERE h.branch_id = ? ORDER BY h.id DESC LIMIT 20`,
    [branchId]
  );
  res.render('manager/handover', { title: 'Branch Handover', consignments, recent });
});

router.post('/handover', (req, res) => {
  const branchId = myBranchId(req);
  const { consignmentId, handoverType, remarks } = req.body;

  const consignment = get(
    `SELECT * FROM consignments WHERE id = ? AND (origin_branch_id = ? OR dest_branch_id = ?)`,
    [consignmentId, branchId, branchId]
  );
  if (!consignment || !['INCOMING', 'OUTGOING'].includes(handoverType)) {
    req.session.flash = { type: 'error', message: 'Invalid handover request.' };
    return res.redirect('/manager/handover');
  }

  transaction(() => {
    run(
      `INSERT INTO branch_handovers (consignment_id, branch_id, handover_type, handled_by, remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [consignment.id, branchId, handoverType, req.session.user.id, remarks || null]
    );
    appendScanEvent({
      consignmentId: consignment.id,
      eventType: handoverType === 'INCOMING' ? 'ARRIVED_AT_BRANCH' : 'DEPARTED_BRANCH',
      branchId,
      remarks: remarks || `${handoverType === 'INCOMING' ? 'Arrived at' : 'Departed'} branch.`,
      recordedBy: req.session.user.id,
    });
  });

  req.session.flash = { type: 'success', message: 'Handover recorded.' };
  res.redirect('/manager/handover');
});

// REQ-6.1: branch-level report for a selected period.
router.get('/reports', (req, res) => {
  const branchId = myBranchId(req);
  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from || today;
  const to = req.query.to || today;

  const summary = get(
    `SELECT
       COUNT(*) AS bookings,
       SUM(CASE WHEN current_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN current_status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
     FROM consignments
     WHERE origin_branch_id = ? AND date(created_at) BETWEEN date(?) AND date(?)`,
    [branchId, from, to]
  );

  const failedAttempts = get(
    `SELECT COUNT(*) AS n FROM scan_events se
     JOIN consignments c ON c.id = se.consignment_id
     WHERE c.origin_branch_id = ? AND se.event_type = 'DELIVERY_FAILED' AND date(se.created_at) BETWEEN date(?) AND date(?)`,
    [branchId, from, to]
  );

  const revenue = get(
    `SELECT COALESCE(SUM(i.amount), 0) AS total
     FROM invoices i JOIN consignments c ON c.id = i.consignment_id
     WHERE c.origin_branch_id = ? AND date(i.generated_at) BETWEEN date(?) AND date(?)`,
    [branchId, from, to]
  );

  const handovers = get(
    `SELECT
       SUM(CASE WHEN handover_type = 'INCOMING' THEN 1 ELSE 0 END) AS incoming,
       SUM(CASE WHEN handover_type = 'OUTGOING' THEN 1 ELSE 0 END) AS outgoing
     FROM branch_handovers WHERE branch_id = ? AND date(created_at) BETWEEN date(?) AND date(?)`,
    [branchId, from, to]
  );

  res.render('manager/reports', {
    title: 'Branch Reports', from, to, summary, failedAttempts, revenue, handovers,
  });
});

module.exports = router;
