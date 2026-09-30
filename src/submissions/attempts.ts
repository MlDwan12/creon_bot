/**
 * Номер каждой попытки креатора по заказу: id отклика → 1, 2, 3…
 * `submissions` — все отклики одного заказа в любом порядке.
 */
export function attemptNumbers(
  submissions: { id: number; creatorId: number; createdAt: Date }[],
): Map<number, number> {
  const perCreator = new Map<number, number>();
  const result = new Map<number, number>();
  const oldestFirst = [...submissions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  for (const s of oldestFirst) {
    const n = (perCreator.get(s.creatorId) ?? 0) + 1;
    perCreator.set(s.creatorId, n);
    result.set(s.id, n);
  }
  return result;
}
