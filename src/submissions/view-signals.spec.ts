import type { ViewSnapshotSource } from '@prisma/client';
import { viewSignals } from './view-signals';

const snap = (
  views: number,
  likes: number | null,
  source: ViewSnapshotSource = 'CHECK',
) => ({ views, likes, source, at: new Date('2026-11-01') });

describe('сигналы накрутки (viewSignals)', () => {
  it('мало лайков — по последнему снимку, где они известны', () => {
    const r = viewSignals(
      [snap(10_000, 200), snap(20_000, 50), snap(30_000, null)],
      250,
    );
    expect(r.likesShare).toBe(0.0025);
    expect(r.lowLikes).toBe(true);
    expect(viewSignals([snap(10_000, 100)], 250).lowLikes).toBe(false);
  });

  it('«ровно до порога» — заявлено при сдаче не больше чем на 10% выше', () => {
    expect(
      viewSignals([snap(1_100, null, 'SUBMIT')], 1_000).nearThreshold,
    ).toBe(true);
    expect(
      viewSignals([snap(1_101, null, 'SUBMIT')], 1_000).nearThreshold,
    ).toBe(false);
    // снимка при сдаче нет (старый ролик) — пометки нет
    expect(viewSignals([snap(1_000, null)], 1_000).nearThreshold).toBe(false);
  });

  it('скачок — больше чем вдвое и хотя бы на 1000 между соседними снимками', () => {
    const r = viewSignals(
      [snap(500, null), snap(1_200, null), snap(5_000, null)],
      250,
    );
    expect(r.jumps.map((j) => [j.from, j.to])).toEqual([[1_200, 5_000]]);
    expect(viewSignals([], 250)).toEqual({
      likesShare: null,
      lowLikes: false,
      nearThreshold: false,
      jumps: [],
    });
  });
});
