import { createFormat } from '@fixum/shared';
import { i18next, locale } from './i18n';

// Форматирование — общее с мини-аппом (packages/shared/src/format.ts), здесь — на переводе сайта.
export const {
  formatDate,
  formatDateTime,
  formatDeadline,
  formatCompact,
  describeVideoUrl,
  approxRub,
  budgetViews,
  timeAgo,
  formatMoney,
  formatCpm,
  formatViews,
  formatVideoFormat,
  videoFormatParts,
  waitingFor,
  isWaitingLong,
} = createFormat({ t: (key, options) => i18next.t(key, options), locale });

/** В системе включено «уменьшить движение» — прокрутка без анимации. */
export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
