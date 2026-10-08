const dates = require("../utils/date.ts");

function isExpired(text, days, now) {
  return dates.addDays(dates.parseDate(text), days) < now;
}

module.exports = { isExpired };
