import { tr } from '../i18n/request-lang';
import { BadRequestException } from '@nestjs/common';
import { PLATFORMS, platformOf } from '../common/platforms';
import { MAX_URL_LENGTH, VIDEO_URL_RE } from '../common/validation';
import { parseViews } from '../orders/order-input';

/** Тело `POST /api/submissions/:id/video` → ссылка на публикацию и просмотры, которые указал креатор. */
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
  return { url, views: parseViews(b.views) };
}
