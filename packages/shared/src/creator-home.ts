import type { Balance, MySubmission, SocialAccount } from './api';
import { heldVideos } from './format';

/** Креатор скрыл чек-лист «Старт». */
export const START_HIDDEN_KEY = 'fixum:startHidden';

export type StartStep = 'wallet' | 'account' | 'order' | 'lesson';

/**
 * Сводка «Сейчас важно» сверху каталога — из баланса, откликов и аккаунтов площадок, без своего
 * запроса. Пусто (всё null и 0) — карточку не показываем. `start` — чек-лист новичка, пока нет ни
 * одного одобренного ролика; всё отмечено — null.
 */
export function creatorHome(
  balance: Balance,
  subs: MySubmission[],
  accounts: SocialAccount[],
) {
  const money =
    balance.available > 0 || balance.held > 0
      ? {
          available: balance.available,
          held: balance.held,
          // ближайший ролик в холде — когда деньги станут доступны
          releaseAt: heldVideos(subs)[0]?.holdEndsAt ?? balance.nextReleaseAt,
        }
      : null;
  // ближайший срок сдачи среди слотов «в работе» (на паузе срока нет — dueAt null)
  const due =
    subs
      .filter((s) => s.status === 'IN_PROGRESS' && s.dueAt)
      .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0] ?? null;
  // как «Отправить новую работу» в карточке отклика: последний по заказу, заказ открыт
  const resubmit = subs.filter(
    (s) =>
      (s.status === 'MODERATOR_REJECTED' || s.status === 'SLOT_EXPIRED') &&
      s.latest &&
      s.order.status === 'OPEN',
  ).length;

  const steps: { step: StartStep; done: boolean }[] = [
    { step: 'wallet', done: !!balance.wallet },
    // подключение включено ключами площадок; нет ни одной — пункта нет
    ...(accounts.length
      ? [
          {
            step: 'account' as const,
            done: accounts.some((a) => a.accounts.length > 0),
          },
        ]
      : []),
    { step: 'order', done: subs.length > 0 },
    { step: 'lesson', done: balance.lessonSeen },
  ];
  const start =
    subs.some((s) => s.status === 'MODERATOR_APPROVED') ||
    steps.every((s) => s.done)
      ? null
      : steps;
  return { money, due, resubmit, start };
}
