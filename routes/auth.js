const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../db/database');
const { redirectIfAuthed, homeFor } = require('../middleware/auth');

const router = express.Router();

// REQ-7.1: registered users can log in and log out.
router.get('/login', redirectIfAuthed, (req, res) => {
  res.render('auth/login', { title: 'Log In' });
});

router.post('/login', redirectIfAuthed, (req, res) => {
  const { email, password } = req.body;
  const user = get('SELECT * FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    req.session.flash = { type: 'error', message: 'Invalid email or password.' };
    return res.redirect('/login');
  }
  if (!user.is_active) {
    req.session.flash = { type: 'error', message: 'This account has been deactivated. Contact an administrator.' };
    return res.redirect('/login');
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branch_id: user.branch_id,
  };
  res.redirect(homeFor(user.role));
});

// Self-registration is for Senders only; Agents/Managers/Admins are provisioned by an Administrator (REQ-7.2).
router.get('/register', redirectIfAuthed, (req, res) => {
  res.render('auth/register', { title: 'Create Sender Account' });
});

router.post('/register', redirectIfAuthed, (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!name || !cleanEmail || !password) {
    req.session.flash = { type: 'error', message: 'All fields are required.' };
    return res.redirect('/register');
  }
  if (password.length < 6) {
    req.session.flash = { type: 'error', message: 'Password must be at least 6 characters.' };
    return res.redirect('/register');
  }
  if (password !== confirmPassword) {
    req.session.flash = { type: 'error', message: 'Passwords do not match.' };
    return res.redirect('/register');
  }
  const existing = get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
  if (existing) {
    req.session.flash = { type: 'error', message: 'An account with that email already exists.' };
    return res.redirect('/register');
  }

  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = run(
    `INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, 'SENDER', NULL)`,
    [name.trim(), cleanEmail, hash]
  );

  req.session.user = { id: lastInsertRowid, name: name.trim(), email: cleanEmail, role: 'SENDER', branch_id: null };
  req.session.flash = { type: 'success', message: 'Account created. Welcome to PARCELTRAK!' };
  res.redirect('/sender');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
