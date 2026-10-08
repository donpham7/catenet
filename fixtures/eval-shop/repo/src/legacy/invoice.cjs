const { displayPrice } = require("../pricing/index.ts");

function invoiceLine(label, amount) {
  return `${label}: ${displayPrice(amount)}`;
}

module.exports = { invoiceLine };
