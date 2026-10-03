const express = require('express');
const bcrypt = require('bcryptjs');
const { get, all, run } = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('ADMIN'));

router.get('/', (req, res) => {
  const stats = get(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE is_active = 1) AS active_users,
      (SELECT COUNT(*) FROM branches WHERE is_active = 1) AS active_branches,
      (SELECT COUNT(*) FROM consignments) AS total_consignments,
      (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE status = 'PAID') AS revenue_collected,
      (SELECT COALESCE(SUM(amount), 0) FROM invoices WHERE status = 'UNPAID') AS revenue_outstanding
  `);
  res.render('admin/dashboard', { title: 'Admin Dashboard', stats });
});

// ---- Users (REQ-7.2) ----
router.get('/users', (req, res) => {
  const users = all(`SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.id DESC`);
  const branches = all('SELECT * FROM branches ORDER BY name');
  res.render('admin/users', { title: 'Manage Users', users, branches, errors: [], form: {} });
});

router.post('/users', (req, res) => {
  const { name, email, password, role, branchId } = req.body;
  const branches = all('SELECT * FROM branches ORDER BY name');
  const errors = [];
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!name || !cleanEmail || !password || !role) errors.push('Name, email, password, and role are required.');
  if (!['SENDER', 'AGENT', 'MANAGER', 'ADMIN'].includes(role)) errors.push('Invalid role.');
  if (['AGENT', 'MANAGER'].includes(role) && !branchId) errors.push('Agents and Managers must be assigned a branch.');
  if (password && password.length < 6) errors.push('Password must be at least 6 characters.');
  if (cleanEmail && get('SELECT id FROM users WHERE email = ?', [cleanEmail])) errors.push('A user with that email already exists.');

  if (errors.length) {
    const users = all(`SELECT u.*, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.id DESC`);
    return res.render('admin/users', { title: 'Manage Users', users, branches, errors, form: req.body });
  }

  const hash = bcrypt.hashSync(password, 10);
  run(
    `INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, ?, ?)`,
    [name.trim(), cleanEmail, hash, role, ['AGENT', 'MANAGER'].includes(role) ? branchId : null]
  );

  req.session.flash = { type: 'success', message: 'User created.' };
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle-active', (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).render('errors/404', { title: 'Not Found' });
  if (user.id === req.session.user.id) {
    req.session.flash = { type: 'error', message: 'You cannot deactivate your own account.' };
    return res.redirect('/admin/users');
  }
  run('UPDATE users SET is_active = ? WHERE id = ?', [user.is_active ? 0 : 1, user.id]);
  req.session.flash = { type: 'success', message: `${user.name} is now ${user.is_active ? 'deactivated' : 'active'}.` };
  res.redirect('/admin/users');
});

router.post('/users/:id/update', (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).render('errors/404', { title: 'Not Found' });
  const { role, branchId } = req.body;
  if (!['SENDER', 'AGENT', 'MANAGER', 'ADMIN'].includes(role)) {
    req.session.flash = { type: 'error', message: 'Invalid role.' };
    return res.redirect('/admin/users');
  }
  run('UPDATE users SET role = ?, branch_id = ? WHERE id = ?', [role, ['AGENT', 'MANAGER'].includes(role) ? (branchId || null) : null, user.id]);
  req.session.flash = { type: 'success', message: `${user.name} updated.` };
  res.redirect('/admin/users');
});

// ---- Branches (REQ-7.2) ----
router.get('/branches', (req, res) => {
  const branches = all('SELECT * FROM branches ORDER BY id DESC');
  res.render('admin/branches', { title: 'Manage Branches', branches, errors: [], form: {} });
});

router.post('/branches', (req, res) => {
  const { code, name, address } = req.body;
  const errors = [];
  const cleanCode = String(code || '').trim().toUpperCase();
  if (!cleanCode || !name) errors.push('Branch code and name are required.');
  if (cleanCode && get('SELECT id FROM branches WHERE code = ?', [cleanCode])) errors.push('A branch with that code already exists.');

  if (errors.length) {
    const branches = all('SELECT * FROM branches ORDER BY id DESC');
    return res.render('admin/branches', { title: 'Manage Branches', branches, errors, form: req.body });
  }

  run('INSERT INTO branches (code, name, address) VALUES (?, ?, ?)', [cleanCode, name.trim(), (address || '').trim()]);
  req.session.flash = { type: 'success', message: 'Branch created.' };
  res.redirect('/admin/branches');
});

router.post('/branches/:id/toggle-active', (req, res) => {
  const branch = get('SELECT * FROM branches WHERE id = ?', [req.params.id]);
  if (!branch) return res.status(404).render('errors/404', { title: 'Not Found' });
  run('UPDATE branches SET is_active = ? WHERE id = ?', [branch.is_active ? 0 : 1, branch.id]);
  req.session.flash = { type: 'success', message: `${branch.name} is now ${branch.is_active ? 'deactivated' : 'active'}.` };
  res.redirect('/admin/branches');
});

// ---- Tariff rules (REQ-7.2 / REQ-5.1 configuration) ----
router.get('/tariffs', (req, res) => {
  const tariffs = all('SELECT * FROM tariff_rules ORDER BY id DESC');
  res.render('admin/tariffs', { title: 'Tariff Rules', tariffs, errors: [], form: {} });
});

router.post('/tariffs', (req, res) => {
  const { name, ratePerKg, volumetricDivisor, minCharge } = req.body;
  const errors = [];
  const rate = parseFloat(ratePerKg), divisor = parseFloat(volumetricDivisor), min = parseFloat(minCharge);
  if (!name) errors.push('Tariff name is required.');
  if (!(rate > 0)) errors.push('Rate per kg must be a positive number.');
  if (!(divisor > 0)) errors.push('Volumetric divisor must be a positive number.');
  if (!(min >= 0)) errors.push('Minimum charge must be zero or more.');

  if (errors.length) {
    const tariffs = all('SELECT * FROM tariff_rules ORDER BY id DESC');
    return res.render('admin/tariffs', { title: 'Tariff Rules', tariffs, errors, form: req.body });
  }

  // Only one tariff is active at a time, so billing always resolves unambiguously.
  run(`UPDATE tariff_rules SET is_active = 0`);
  run(
    `INSERT INTO tariff_rules (name, rate_per_kg, volumetric_divisor, min_charge, is_active) VALUES (?, ?, ?, ?, 1)`,
    [name.trim(), rate, divisor, min]
  );

  req.session.flash = { type: 'success', message: 'New tariff created and activated.' };
  res.redirect('/admin/tariffs');
});

router.post('/tariffs/:id/activate', (req, res) => {
  const tariff = get('SELECT * FROM tariff_rules WHERE id = ?', [req.params.id]);
  if (!tariff) return res.status(404).render('errors/404', { title: 'Not Found' });
  run('UPDATE tariff_rules SET is_active = 0');
  run('UPDATE tariff_rules SET is_active = 1 WHERE id = ?', [tariff.id]);
  req.session.flash = { type: 'success', message: `${tariff.name} is now the active tariff.` };
  res.redirect('/admin/tariffs');
});

module.exports = router;
