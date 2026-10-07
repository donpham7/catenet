// CommonJS exports: a named function expression and a local function exported by name.
const { round } = require("../lib/math");

exports.double = function double(n) {
  return round(n * 2);
};

function triple(n) {
  return n * 3;
}

module.exports.triple = triple;
