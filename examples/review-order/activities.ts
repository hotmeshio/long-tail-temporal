/** Example business activities. */
export async function scoreOrder(orderId: string): Promise<number> {
  return orderId.length % 10;
}

export async function shipOrder(orderId: string): Promise<string> {
  return `shipped ${orderId}`;
}
