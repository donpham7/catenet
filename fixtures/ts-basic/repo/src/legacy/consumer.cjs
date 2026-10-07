// Member call on a required module, a required module called directly (its default export), and an
// object-literal module.exports.
const helpers = require("./helpers.cjs");
const report = require("./report.cjs");

module.exports = {
  run: (n) => report(helpers.double(n)),
};
