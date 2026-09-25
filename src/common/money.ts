/**
 * Деньги в базе — в копейках (целые): комиссии и выплаты дают дробные рубли.
 * В API и на клиенте — рубли; переводим только на границе API.
 */
export function rublesToKopecks(rubles: number): number {
  return Math.round(rubles * 100);
}

export function kopecksToRubles<T extends number | null>(kopecks: T): T {
  return (kopecks === null ? null : kopecks / 100) as T;
}
