const { isValidEmail } = require("../validation/email.ts");

function canSend(to) {
  return isValidEmail(to) === true;
}

module.exports = { canSend };
