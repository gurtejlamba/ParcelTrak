const { run } = require('../db/database');

// REQ-2.2: current_status is always just a cache of the latest appended scan event.
// It is only ever written here, in lockstep with the INSERT into scan_events.
function appendScanEvent({ consignmentId, eventType, branchId = null, remarks = null, recordedBy }) {
  run(
    `INSERT INTO scan_events (consignment_id, event_type, branch_id, remarks, recorded_by)
     VALUES (?, ?, ?, ?, ?)`,
    [consignmentId, eventType, branchId, remarks, recordedBy]
  );
  run('UPDATE consignments SET current_status = ? WHERE id = ?', [eventType, consignmentId]);
}

const STATUS_LABELS = {
  BOOKED: 'Booked',
  CANCELLED: 'Cancelled',
  PICKED_UP: 'Picked Up',
  ARRIVED_AT_BRANCH: 'Arrived at Branch',
  DEPARTED_BRANCH: 'Departed Branch',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERY_FAILED: 'Delivery Attempt Failed',
  DELIVERED: 'Delivered',
  RETURNED: 'Returned to Sender',
};

module.exports = { appendScanEvent, STATUS_LABELS };
