import type { ViewSnapshot, ViewSnapshotSource } from '@prisma/client';

/** Точка истории: снимок из базы или «сейчас по API» (NOW — при открытии карточки, не хранится). */
export type ViewPoint = Pick<ViewSnapshot, 'views' | 'likes' | 'at'> & {
  source: ViewSnapshotSource | 'NOW';
};

/** Лайков меньше этой доли от просмотров — подозрительно мало для живой аудитории. */
export const LOW_LIKES_SHARE = 0.005;
/** Заявлено при сдаче не больше чем на столько выше порога — «ровно до порога». */
export const NEAR_THRESHOLD = 0.1;
/** Скачок: между соседними снимками просмотры выросли больше чем вдвое и хотя бы на столько. */
const JUMP_MIN_GROWTH = 1000;

/**
 * Сигналы накрутки по истории просмотров ролика — модератору факты, а не оценка: решает он.
 * Креатор их не видит. `snapshots` — от старых к новым.
 * ponytail: пороги подобраны на глаз; появятся данные об отклонённых за накрутку — подстроить.
 */
export function viewSignals(snapshots: ViewPoint[], minViews: number) {
  // доля лайков — по последнему снимку, где они известны
  const withLikes = snapshots.filter((s) => s.likes !== null && s.views > 0);
  const last = withLikes[withLikes.length - 1];
  const likesShare = last ? last.likes! / last.views : null;

  const submitted = snapshots.find((s) => s.source === 'SUBMIT');
  const jumps = snapshots.slice(1).flatMap((s, i) => {
    const prev = snapshots[i];
    return s.views > prev.views * 2 && s.views - prev.views >= JUMP_MIN_GROWTH
      ? [{ from: prev.views, to: s.views, at: s.at }]
      : [];
  });

  return {
    likesShare,
    lowLikes: likesShare !== null && likesShare < LOW_LIKES_SHARE,
    nearThreshold:
      !!submitted && submitted.views <= minViews * (1 + NEAR_THRESHOLD),
    jumps,
  };
}
