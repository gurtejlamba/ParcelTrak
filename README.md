# PARCELTRAK — Courier Management System

A working implementation of the PARCELTRAK SRS (v1.0): a web-based courier
management system that replaces paper waybills with a single auditable
platform for booking, transit scanning, delivery, and billing.

## Tech stack

- **Node.js + Express** — server and routing
- **EJS** — server-rendered views (no build step)
- **`node:sqlite`** (Node's built-in SQLite module, Node 22.5+) — zero native
  dependencies, zero setup. The database file lives at `data/parceltrak.db`
  and is created automatically on first run.
- **express-session** + **bcryptjs** — auth
- Vanilla JS/CSS on the client — no frontend framework, no build pipeline

## Getting started

```bash
npm install
npm start
```

Then open <http://localhost:3000>. The database is created and seeded
automatically on first run (safe to re-run — it only seeds when the `users`
table is empty). To wipe and reseed: delete `data/parceltrak.db` and start
the server again, or run `npm run seed`.

### Demo accounts (password: `password123` for all)

| Email | Role | Branch |
|---|---|---|
| `admin@parceltrak.test` | Administrator | — |
| `manager@parceltrak.test` | Branch Manager | Jaipur Hub |
| `agent1@parceltrak.test` | Delivery Agent | Jaipur Hub |
| `agent2@parceltrak.test` | Delivery Agent | Jaipur Hub |
| `sender@parceltrak.test` | Sender | — |

New Sender accounts can also self-register at `/register`. Agent, Manager,
and Admin accounts are provisioned by an Administrator (`/admin/users`), per
REQ-7.2.

## Project structure

```
parceltrak/
  server.js              entry point, middleware, view locals
  db/
    schema.sql            table definitions + append-only triggers
    database.js           node:sqlite connection + query helpers
    seed.js                demo data (branches, one user per role, tariff)
  middleware/auth.js       session auth + role-based route guards
  routes/                  one router per module (see below)
  utils/
    tracking.js            tracking number generation
    billing.js              chargeable weight + invoice generation
    scanEvents.js            append-only event log + status cache
  views/                   EJS templates, one folder per role + public/auth
  public/                  CSS and the signature-pad canvas script
```

## How the 7 SRS modules map to the code

| # | Module | Routes | Notes |
|---|---|---|---|
| 1 | Booking & Consignment | `routes/sender.js` (`/sender/book`, `/sender/consignments/:id/cancel`) | REQ-1.1/1.2. Cancel is only allowed while `current_status = 'BOOKED'` (not yet dispatched). |
| 2 | Tracking & Status | `routes/tracking.js` (public, no auth) | REQ-2.1/2.2. `scan_events` is append-only — enforced by SQLite triggers (`BEFORE UPDATE`/`BEFORE DELETE` both `RAISE(ABORT, ...)`), not just application logic. `consignments.current_status` is a read-cache of the latest event, always written in lockstep with the event insert (`utils/scanEvents.js`). |
| 3 | Route Assignment | `routes/manager.js` (`/manager/assign`) | REQ-3.1/3.2. Reassigning marks the old `assignments` row `REASSIGNED` and inserts a new `ACTIVE` one, so assignment history is preserved. Reassignment is blocked once a consignment is `DELIVERED`. |
| 4 | Delivery & Proof | `routes/agent.js` (`/agent/consignments/:id/deliver`, `/fail`) | REQ-4.1/4.2. Proof of delivery captures receiver name + a hand-drawn signature (HTML canvas → PNG data URL, `public/js/signature-pad.js`). A failed attempt appends `DELIVERY_FAILED` and leaves the assignment `ACTIVE` so the agent can re-attempt. |
| 5 | Billing & Settlement | `utils/billing.js`, `routes/sender.js` (`/sender/invoices`) | REQ-5.1. Chargeable weight = `max(actual, volumetric)`; volumetric = `L×W×H ÷ divisor`. An invoice is generated at booking time from the currently active tariff and can be settled (`Pay Now`). |
| 6 | Branch Operations | `routes/manager.js` (`/manager/handover`, `/manager/reports`) | REQ-6.1. Handover records an `INCOMING`/`OUTGOING` entry and a matching scan event. Reports aggregate bookings, deliveries, cancellations, failed attempts, revenue, and handovers for a date range. |
| 7 | Administration | `routes/admin.js`, `routes/auth.js` | REQ-7.1/7.2. Login/logout for all roles; Admin manages users, branches, and tariff rules. Only one tariff rule is active at a time, so billing always resolves unambiguously. |

## Design notes

- **Roles**: `SENDER`, `AGENT`, `MANAGER`, `ADMIN`, enforced by
  `middleware/auth.js#requireRole`. The Recipient is an external party (plain
  text fields on the consignment), not a registered actor — matching the
  SRS's product scope.
- **Auditability**: the append-only guarantee on `scan_events` is enforced at
  the database layer via triggers, so it holds even if application code has a
  bug — not just "the UI doesn't expose an edit button."
- **Branch scoping**: a Manager only sees/operates on consignments passing
  through their own `branch_id`; Agents only see consignments with an
  `ACTIVE` assignment to them (but retain read access to their own completed
  deliveries for history).
- Sessions are in-memory (`express-session` default store), which is fine for
  a single-process academic deployment; swap in a persistent store before any
  multi-process deployment.
