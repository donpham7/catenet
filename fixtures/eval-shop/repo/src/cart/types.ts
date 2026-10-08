export interface CartItem {
  sku: string;
  price: number;
  quantity: number;
}

export interface Cart {
  id: string;
  items: CartItem[];
}
