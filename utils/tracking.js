const { get } = require('../db/database');

/** Generates a unique tracking number like PT20261004-X7K2Q9. */
function generateTrackingNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const candidate = `PT${datePart}-${suffix}`;
    const clash = get('SELECT id FROM consignments WHERE tracking_number = ?', [candidate]);
    if (!clash) return candidate;
  }
  throw new Error('Could not generate a unique tracking number, please retry.');
}

module.exports = { generateTrackingNumber };
