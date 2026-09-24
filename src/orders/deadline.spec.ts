import { extendedDeadline } from './deadline';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-24T12:00:00Z');

describe('extendedDeadline', () => {
  it('срок ещё идёт — дни прибавляются к нему', () => {
    const current = new Date(now.getTime() + 2 * DAY);
    expect(extendedDeadline(current, 7, now)).toEqual(
      new Date(now.getTime() + 9 * DAY),
    );
  });

  it('срок прошёл или его не было — дни считаются от сейчас', () => {
    const past = new Date(now.getTime() - 5 * DAY);
    const week = new Date(now.getTime() + 7 * DAY);
    expect(extendedDeadline(past, 7, now)).toEqual(week);
    expect(extendedDeadline(null, 7, now)).toEqual(week);
  });
});
