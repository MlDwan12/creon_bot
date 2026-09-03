export function parseModeratorIds(raw?: string): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function isModerator(
  telegramId: number,
  moderatorIds: Set<string>,
): boolean {
  return moderatorIds.has(String(telegramId));
}
