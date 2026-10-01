/**
 * Деньги в базе — в центах USDT (целые): комиссии и выплаты дают дробные суммы.
 * В API и на клиенте — USDT; переводим только на границе API.
 */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function fromMinor<T extends number | null>(minor: T): T {
  return (minor === null ? null : minor / 100) as T;
}
