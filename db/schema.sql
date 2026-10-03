-- PARCELTRAK schema
-- Roles: SENDER, AGENT, MANAGER, ADMIN

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SENDER','AGENT','MANAGER','ADMIN')),
  branch_id INTEGER REFERENCES branches(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tariff_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rate_per_kg REAL NOT NULL,
  volumetric_divisor REAL NOT NULL DEFAULT 5000,
  min_charge REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number TEXT UNIQUE NOT NULL,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  origin_branch_id INTEGER NOT NULL REFERENCES branches(id),
  dest_branch_id INTEGER NOT NULL REFERENCES branches(id),
  actual_weight REAL NOT NULL,
  length_cm REAL NOT NULL,
  width_cm REAL NOT NULL,
  height_cm REAL NOT NULL,
  volumetric_weight REAL NOT NULL,
  chargeable_weight REAL NOT NULL,
  -- current_status is a read cache of the latest scan_event.event_type; the scan_events
  -- log is the source of truth and is append-only (see triggers below).
  current_status TEXT NOT NULL DEFAULT 'BOOKED',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consignments_sender ON consignments(sender_id);
CREATE INDEX IF NOT EXISTS idx_consignments_status ON consignments(current_status);

CREATE TABLE IF NOT EXISTS scan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignment_id INTEGER NOT NULL REFERENCES consignments(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'BOOKED','CANCELLED','PICKED_UP','ARRIVED_AT_BRANCH','DEPARTED_BRANCH',
    'OUT_FOR_DELIVERY','DELIVERY_FAILED','DELIVERED','RETURNED'
  )),
  branch_id INTEGER REFERENCES branches(id),
  remarks TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_events_consignment ON scan_events(consignment_id, id);

-- Enforce REQ-2.1 at the data layer: scan events are append-only, full stop.
CREATE TRIGGER IF NOT EXISTS scan_events_no_update
BEFORE UPDATE ON scan_events
BEGIN
  SELECT RAISE(ABORT, 'scan_events are append-only: update not permitted');
END;

CREATE TRIGGER IF NOT EXISTS scan_events_no_delete
BEFORE DELETE ON scan_events
BEGIN
  SELECT RAISE(ABORT, 'scan_events are append-only: delete not permitted');
END;

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignment_id INTEGER NOT NULL REFERENCES consignments(id),
  agent_id INTEGER NOT NULL REFERENCES users(id),
  assigned_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REASSIGNED','COMPLETED')) DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_consignment ON assignments(consignment_id, id);
CREATE INDEX IF NOT EXISTS idx_assignments_agent ON assignments(agent_id, status);

CREATE TABLE IF NOT EXISTS proof_of_delivery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignment_id INTEGER NOT NULL UNIQUE REFERENCES consignments(id),
  receiver_name TEXT NOT NULL,
  signature_data TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
  recorded_by INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignment_id INTEGER NOT NULL UNIQUE REFERENCES consignments(id),
  tariff_rule_id INTEGER NOT NULL REFERENCES tariff_rules(id),
  chargeable_weight REAL NOT NULL,
  rate_applied REAL NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UNPAID','PAID')) DEFAULT 'UNPAID',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS branch_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consignment_id INTEGER NOT NULL REFERENCES consignments(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  handover_type TEXT NOT NULL CHECK (handover_type IN ('INCOMING','OUTGOING')),
  handled_by INTEGER NOT NULL REFERENCES users(id),
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_handovers_branch ON branch_handovers(branch_id, created_at);
