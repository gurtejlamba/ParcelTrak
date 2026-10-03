const { get, run } = require('../db/database');

/** REQ-5.1: chargeable weight is the greater of actual and volumetric weight. */
function computeVolumetricWeight(lengthCm, widthCm, heightCm, divisor) {
  return (lengthCm * widthCm * heightCm) / divisor;
}

function computeChargeableWeight(actualWeight, volumetricWeight) {
  return Math.max(actualWeight, volumetricWeight);
}

function getActiveTariff() {
  const tariff = get('SELECT * FROM tariff_rules WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
  if (!tariff) throw new Error('No active tariff rule is configured. Ask an administrator to set one up.');
  return tariff;
}

/** Generates and persists an invoice for a consignment using the currently active tariff. */
function generateInvoice(consignmentId, chargeableWeight) {
  const tariff = getActiveTariff();
  const amount = Math.max(chargeableWeight * tariff.rate_per_kg, tariff.min_charge);
  const rounded = Math.round(amount * 100) / 100;
  run(
    `INSERT INTO invoices (consignment_id, tariff_rule_id, chargeable_weight, rate_applied, amount, status)
     VALUES (?, ?, ?, ?, ?, 'UNPAID')`,
    [consignmentId, tariff.id, chargeableWeight, tariff.rate_per_kg, rounded]
  );
  return rounded;
}

module.exports = {
  computeVolumetricWeight,
  computeChargeableWeight,
  getActiveTariff,
  generateInvoice,
};
