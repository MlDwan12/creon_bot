import { actionsCsv } from './moderator-actions.service';

describe('actionsCsv', () => {
  it('BOM, «;», подпись действия, сумма и ожидание в минутах; имя-формула экранируется', () => {
    const csv = actionsCsv(
      [
        {
          moderatorId: 1n,
          type: 'PAYOUT_PAID',
          objectId: 7,
          reportTarget: null,
          amountMinor: 1_250,
          waitedSec: 125,
          createdAt: new Date('2026-10-23T10:00:00Z'),
        },
        {
          moderatorId: 2n,
          type: 'REPORT_DISMISS',
          objectId: 3,
          reportTarget: 'ORDER',
          amountMinor: null,
          waitedSec: null,
          createdAt: new Date('2026-10-23T11:00:00Z'),
        },
      ],
      new Map([['1', '=HYPERLINK("x")']]),
    );
    expect(csv.startsWith('﻿')).toBe(true);
    const [, paid, report] = csv.slice(1).split('\r\n');
    expect(paid).toBe(
      `"2026-10-23T10:00:00.000Z";"'=HYPERLINK(""x"")";"Выплата проведена";"#7";"12.5";"2"`,
    );
    // имени нет (не открывал мини-апп) — id; у жалобы — на что она
    expect(report).toBe(
      `"2026-10-23T11:00:00.000Z";"id2";"Жалоба: нарушений нет";"ORDER #3";"";""`,
    );
  });
});
