require('./db/database'); // ensures schema is created before anything else touches the DB
const { seed } = require('./db/seed');
seed(); // no-op if already seeded

const path = require('path');
const express = require('express');
const session = require('express-session');

const { homeFor } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const trackingRoutes = require('./routes/tracking');
const senderRoutes = require('./routes/sender');
const agentRoutes = require('./routes/agent');
const managerRoutes = require('./routes/manager');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true, limit: '2mb' })); // signature data URLs can be a few hundred KB
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'parceltrak-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
}));

// Make current user, flash messages, and helpers available to every view.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.homeFor = homeFor;
  res.locals.statusBadgeClass = (status) => {
    switch (status) {
      case 'BOOKED': return 'badge-booked';
      case 'DELIVERED': return 'badge-delivered';
      case 'DELIVERY_FAILED': return 'badge-failed';
      case 'CANCELLED': return 'badge-cancelled';
      case 'RETURNED': return 'badge-cancelled';
      default: return 'badge-transit'; // PICKED_UP, ARRIVED_AT_BRANCH, DEPARTED_BRANCH, OUT_FOR_DELIVERY
    }
  };
  res.locals.formatMoney = (n) => `₹${Number(n).toFixed(2)}`;
  res.locals.formatDate = (s) => {
    if (!s) return '';
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  };
  next();
});

app.use('/', authRoutes);
app.use('/', trackingRoutes);
app.use('/sender', senderRoutes);
app.use('/agent', agentRoutes);
app.use('/manager', managerRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('errors/500', { title: 'Something Went Wrong', message: err.message });
});

app.listen(PORT, () => {
  console.log(`PARCELTRAK running at http://localhost:${PORT}`);
});
