import { Markup } from 'telegraf';

export const USER_MENU_BUTTONS = {
  CREATE_ORDER: '📢 Разместить заказ',
  BROWSE_ORDERS: '🔍 Доступные заказы',
  MY_ORDERS: '📋 Мои заказы',
  MY_SUBMISSIONS: '📝 Мои отклики',
} as const;

export const MODERATOR_MENU_BUTTONS = {
  ORDER_QUEUE: '🆕 Заказы на проверку',
  SUBMISSION_QUEUE: '🎬 Видео на проверку',
  ALL_ORDERS: '📋 Все заказы',
  STATS: '📊 Статистика',
} as const;

export function userMenuKeyboard() {
  return Markup.keyboard([
    [USER_MENU_BUTTONS.CREATE_ORDER, USER_MENU_BUTTONS.BROWSE_ORDERS],
    [USER_MENU_BUTTONS.MY_ORDERS, USER_MENU_BUTTONS.MY_SUBMISSIONS],
  ]).resize();
}

export function moderatorMenuKeyboard() {
  return Markup.keyboard([
    [
      MODERATOR_MENU_BUTTONS.ORDER_QUEUE,
      MODERATOR_MENU_BUTTONS.SUBMISSION_QUEUE,
    ],
    [MODERATOR_MENU_BUTTONS.ALL_ORDERS, MODERATOR_MENU_BUTTONS.STATS],
  ]).resize();
}
