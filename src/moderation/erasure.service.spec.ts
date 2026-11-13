import { erasureBlockers } from './erasure.service';

describe('что мешает удалить данные', () => {
  const clean = { heldMinor: 0, requestedMinor: 0, availableMinor: 0 };

  it('нет долгов и дел — можно', () => {
    expect(erasureBlockers(0, 0, clean)).toEqual([]);
  });

  it('каждое незавершённое — отдельной строкой', () => {
    expect(
      erasureBlockers(2, 1, {
        heldMinor: 100,
        requestedMinor: 100,
        availableMinor: 100,
      }),
    ).toHaveLength(5);
  });
});
