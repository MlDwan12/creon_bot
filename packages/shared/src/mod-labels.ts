import type { ModeratorActionType, ReportTarget } from './api';

/** Подписи действий модератора — кабинет и история пользователя (окно модератора только на русском; общие с сайтом). */
export const ACTION_LABELS: Record<ModeratorActionType, string> = {
  ORDER_APPROVE: 'Заказ опубликован',
  ORDER_REJECT: 'Заказ отклонён',
  VIDEO_APPROVE: 'Ролик одобрен',
  VIDEO_REJECT: 'Ролик отклонён',
  HOLD_FINALIZE: 'Итог холда',
  PUBLICATION_DELETED: 'Публикация удалена',
  REVIEW_APPROVE: 'Отзыв опубликован',
  REVIEW_REMOVE: 'Отзыв удалён',
  REPORT_ACTION: 'Жалоба: мера',
  REPORT_DISMISS: 'Жалоба: нарушений нет',
  PAYOUT_PAID: 'Выплата проведена',
  PAYOUT_REJECT: 'Выплата отклонена',
  USER_BAN: 'Блокировка',
  USER_UNBAN: 'Разблокировка',
  ADVERTISER_OPEN: 'Кабинет заказчика открыт',
  ADVERTISER_REJECT: 'Заявка в заказчики отклонена',
  ADVERTISER_CLOSE: 'Кабинет заказчика закрыт',
};

/** Объект жалобы словами и ссылка на него в окне модератора. */
export function reportObject(
  target: ReportTarget,
  id: number,
): { text: string; to: string | null } {
  if (target === 'ORDER')
    return { text: `заказ #${id}`, to: `/mod/orders/${id}` };
  if (target === 'VIDEO')
    return { text: `ролик #${id}`, to: `/mod/videos/${id}` };
  if (target === 'REVIEW')
    return { text: `отзыв #${id}`, to: `/mod/videos/${id}` };
  return { text: 'профиль', to: null };
}

/**
 * Причины отказа по требованиям заказа — первыми в выборе причины: креатор видит, какой именно
 * пункт не выполнен, а одинаковый текст складывается в «Что работает» (частые причины отказа).
 */
export function requirementReasons(requirements: string[]): string[] {
  return requirements.map((r) => `Не выполнено требование: «${r}»`);
}
