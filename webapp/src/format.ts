import { createFormat } from '@fixum/shared';
import { i18next, locale } from './i18n';

// Форматирование — общее с сайтом (packages/shared/src/format.ts), здесь — на переводе мини-аппа.
export const {
  formatDate,
  formatDeadline,
  timeAgo,
  formatMoney,
  approxRub,
  formatCpm,
  formatViews,
  budgetViews,
  formatVideoFormat,
  videoFormatParts,
  formatCompact,
  formatPlatforms,
  waitingFor,
  isWaitingLong,
  describeVideoUrl,
} = createFormat({ t: (key, options) => i18next.t(key, options), locale });
