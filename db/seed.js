// Seeds demo branches, users (one per role), and an active tariff rule.
// Safe to re-run: skips seeding if any users already exist.
const bcrypt = require('bcryptjs');
const { get, run, transaction } = require('./database');

const DEMO_PASSWORD = 'password123';

function seed() {
  const existing = get('SELECT COUNT(*) AS n FROM users');
  if (existing.n > 0) {
    console.log('Database already seeded (users exist). Skipping.');
    return;
  }

  transaction(() => {
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

    const jaipur = run(
      `INSERT INTO branches (code, name, address) VALUES (?, ?, ?)`,
      ['JAI', 'Jaipur Hub', 'Malviya Nagar, Jaipur, Rajasthan']
    ).lastInsertRowid;

    const delhi = run(
      `INSERT INTO branches (code, name, address) VALUES (?, ?, ?)`,
      ['DEL', 'Delhi Hub', 'Karol Bagh, New Delhi']
    ).lastInsertRowid;

    const mumbai = run(
      `INSERT INTO branches (code, name, address) VALUES (?, ?, ?)`,
      ['BOM', 'Mumbai Hub', 'Andheri East, Mumbai, Maharashtra']
    ).lastInsertRowid;

    run(
      `INSERT INTO tariff_rules (name, rate_per_kg, volumetric_divisor, min_charge, is_active) VALUES (?, ?, ?, ?, 1)`,
      ['Standard Tariff 2026', 45, 5000, 60]
    );

    const admin = run(
      `INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, 'ADMIN', NULL)`,
      ['System Administrator', 'admin@parceltrak.test', hash]
    ).lastInsertRowid;

    const manager = run(
      `INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, 'MANAGER', ?)`,
      ['Rina Shah', 'manager@parceltrak.test', hash, jaipur]
    ).lastInsertRowid;

    const agent1 = run(
      `INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, 'AGENT', ?)`,
      ['Arjun Mehta', 'agent1@parceltrak.test', hash, jaipur]
    ).lastInsertRowid;

    const agent2 = run(
      `INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, 'AGENT', ?)`,
      ['Karan Verma', 'agent2@parceltrak.test', hash, jaipur]
    ).lastInsertRowid;

    const sender = run(
      `INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, 'SENDER', NULL)`,
      ['Priya Nair', 'sender@parceltrak.test', hash]
    ).lastInsertRowid;

    console.log('Seed complete.');
    console.log('Branches:', { jaipur, delhi, mumbai });
    console.log('Users:', { admin, manager, agent1, agent2, sender });
    console.log('\nDemo login password for all accounts:', DEMO_PASSWORD);
    console.log('  admin@parceltrak.test    (Administrator)');
    console.log('  manager@parceltrak.test  (Branch Manager, Jaipur Hub)');
    console.log('  agent1@parceltrak.test   (Delivery Agent, Jaipur Hub)');
    console.log('  agent2@parceltrak.test   (Delivery Agent, Jaipur Hub)');
    console.log('  sender@parceltrak.test   (Sender)');
  });
}

if (require.main === module) {
  seed();
}

module.exports = { seed, DEMO_PASSWORD };
