const { formatDate, parseDate } = require("../utils/date.ts");

function normalize(text) {
  return formatDate(parseDate(text));
}

module.exports = { normalize };
