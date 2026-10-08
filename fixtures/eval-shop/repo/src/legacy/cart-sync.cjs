const store = require("../cart/store.ts");

function itemCount(cartId) {
  return store.getCart(cartId).items.reduce((n, item) => n + item.quantity, 0);
}

module.exports = { itemCount };
