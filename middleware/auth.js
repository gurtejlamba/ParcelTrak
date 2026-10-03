function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'error', message: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.session.flash = { type: 'error', message: 'Please log in to continue.' };
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('errors/403', { title: 'Access Denied' });
    }
    next();
  };
}

function redirectIfAuthed(req, res, next) {
  if (req.session.user) {
    return res.redirect(homeFor(req.session.user.role));
  }
  next();
}

function homeFor(role) {
  switch (role) {
    case 'SENDER': return '/sender';
    case 'AGENT': return '/agent';
    case 'MANAGER': return '/manager';
    case 'ADMIN': return '/admin';
    default: return '/';
  }
}

module.exports = { requireAuth, requireRole, redirectIfAuthed, homeFor };
