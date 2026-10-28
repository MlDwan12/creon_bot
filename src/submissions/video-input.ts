import { tr } from '../i18n/request-lang';
import { BadRequestException } from '@nestjs/common';
import {
  PLATFORMS,
  isTiktokShortLink,
  platformOf,
  videoIdKey,
} from '../common/platforms';
import { MAX_URL_LENGTH, VIDEO_URL_RE } from '../common/validation';
import { parseViews } from '../orders/order-input';
import { toMinor } from '../common/money';

/**
 * Тело `POST /api/submissions/:id/video` → ссылка на публикацию и просмотры, которые указал креатор.
 * `acceptPayout` — креатор согласился на остаток фонда (USDT), когда просмотры за него вышли
 * (SubmissionsService.attachVideo, 409 OVER_BUDGET); нет — ещё не спрашивали. `bioLinkConfirmed` —
 * ссылка стоит в шапке профиля (нужно, если в заказе Order.linkInBio; проверяет submitVideo).
 */
export function parseVideoSubmission(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const url = typeof b.videoUrl === 'string' ? b.videoUrl.trim() : '';
  if (!VIDEO_URL_RE.test(url))
    throw new BadRequestException(tr('errors.notALink'));
  if (url.length > MAX_URL_LENGTH)
    throw new BadRequestException(
      tr('errors.linkTooLong', { max: MAX_URL_LENGTH }),
    );
  // Просмотры считаем по публикации на площадке: иначе модератору нечего сверять.
  if (platformOf(url) === 'OTHER')
    throw new BadRequestException(
      tr('errors.videoPlatform', {
        platforms: Object.values(PLATFORMS)
          .map((p) => p.name)
          .join(', '),
      }),
    );
  // Без id ролика один ролик сдали бы дважды под разными ссылками (Submission.videoKey).
  // Короткую ссылку TikTok раскрывает SubmissionsService.submitVideo.
  if (!videoIdKey(url) && !isTiktokShortLink(url))
    throw new BadRequestException(tr('errors.videoNotPost'));
  const accept = b.acceptPayout;
  if (
    accept !== undefined &&
    accept !== null &&
    (typeof accept !== 'number' || !Number.isFinite(accept) || accept < 0)
  )
    throw new BadRequestException(tr('errors.badAcceptPayout'));
  return {
    url,
    views: parseViews(b.views),
    acceptMinor: typeof accept === 'number' ? toMinor(accept) : null,
    bioLinkConfirmed: b.bioLinkConfirmed === true,
  };
}
