// CommonJS require with a literal path.
const { formatCurrency } = require("../lib/format");

module.exports = function report(amount) {
  return "Report: " + formatCurrency(amount);
};
