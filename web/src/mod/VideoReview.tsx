import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  errorText,
  fetchModVideo,
  finalizeVideo,
  markPublicationDeleted,
  type ModVideo,
  moderateVideo,
  PLATFORM_NAMES,
  safeUrl,
} from '../api';
import {
  formatCpm,
  formatDate,
  formatMoney,
  formatViews,
  timeAgo,
  videoFormatParts,
} from '../format';
import s from '../ui.module.css';
import { PlatformIcon } from '../components/PlatformIcon';
import { ReasonPicker } from './ReasonPicker';

const PRESETS = [
  'Не соответствует заданию',
  'Не та длительность ролика',
  'Не та ориентация (вертикаль / горизонталь)',
  'Меньше порога просмотров',
  'Публикация закрыта или удалена',
  'Ссылка не открывается — проверьте доступ',
  'Низкое качество видео',
  'Водяной знак или чужой логотип',
  'Чужой или перезалитый ролик',
];

/** Откуда ролик: проверка или итог холда — после решения открывается следующий из той же вкладки. */
export type VideoTab = 'videos' | 'holds';

/**
 * Проверка ролика или итог холда — то же, что в мини-аппе (webapp/src/views/mod/ModVideoView.tsx),
 * в две колонки: слева сверка, справа решение. `onDone` — решение принято.
 */
export function VideoReview({
  id,
  onDone,
}: {
  id: number;
  onDone: (tab: VideoTab) => void;
}) {
  const [video, setVideo] = useState<ModVideo>();
  const [loadError, setLoadError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Нажали «Отклонить» — показываем причины: так отказ не нажать по ошибке. */
  const [rejecting, setRejecting] = useState(false);
  /** Сверка с требованиями — памятка, одобрить можно и без всех галочек. */
  const [checked, setChecked] = useState(new Set<string>());
  /** Просмотры, которые фиксирует модератор: на проверке — заявленные креатором, при итоге — текущие. */
  const [views, setViews] = useState('');
  /** Лайки — только для отчёта рекламодателю, по желанию; пусто — неизвестно. */
  const [likes, setLikes] = useState('');
  const likesOrNull = () => (likes === '' ? null : Number(likes));

  const load = useCallback(async () => {
    try {
      const v = await fetchModVideo(id);
      setVideo(v);
      // просмотры из API площадки точнее заявленных — подставляем их
      setViews(String(v.autoViews ?? v.views ?? ''));
      setLikes(String(v.autoLikes ?? v.likes ?? ''));
    } catch (err) {
      setLoadError(errorText(err, 'Не удалось загрузить видео'));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  function toggleCheck(item: string) {
    const next = new Set(checked);
    if (!next.delete(item)) next.add(item);
    setChecked(next);
  }

  async function run(action: () => Promise<unknown>, tab: VideoTab) {
    setBusy(true);
    setError('');
    try {
      await action();
      onDone(tab);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (loadError) return <p className={s.hint}>{loadError}</p>;
  if (!video) return <p className={s.hint}>Загрузка…</p>;

  /**
   * Насчитали меньше половины указанных креатором — одобрить нельзя (бэкенд не пропустит):
   * это завышение, вместо «Одобрить» — отказ за завышенные просмотры, ролик больше не сдать.
   */
  const inflated =
    video.status === 'SUBMITTED' &&
    video.views !== null &&
    !!Number(views) &&
    Number(views) < video.views * 0.5;
  const decide = (decision: 'approve' | 'reject' | 'inflated') =>
    run(
      () =>
        moderateVideo(
          id,
          decision,
          decision === 'reject'
            ? { comment }
            : decision === 'inflated'
              ? {}
              : { views: Number(views), likes: likesOrNull() },
        ),
      'videos',
    );
  const finalize = () =>
    run(() => finalizeVideo(id, Number(views), likesOrNull()), 'holds');
  function deleted(bioLink: boolean) {
    const question = bioLink
      ? 'Ссылки креатора нет в шапке профиля? Начисление за ролик отменится, деньги вернутся в бюджет заказа.'
      : 'Публикации нет по ссылке? Начисление за ролик отменится, деньги вернутся в бюджет заказа.';
    if (window.confirm(question))
      void run(() => markPublicationDeleted(id, bioLink), 'holds');
  }

  /** Сколько начислится за введённые просмотры (без учёта остатка бюджета). */
  const cpm = video.order.cpm;
  const estimate =
    cpm && Number(views)
      ? formatMoney(Math.floor((Number(views) * cpm) / 10) / 100)
      : '';
  /** Когда кончается холд и можно зафиксировать итог; null — не одобрен или уже зафиксирован. */
  const holdEndsAt =
    video.status !== 'MODERATOR_APPROVED' ||
    video.finalizedAt ||
    !video.decidedAt
      ? null
      : new Date(
          new Date(video.decidedAt).getTime() +
            video.holdDays * 24 * 60 * 60 * 1000,
        );
  const holdOver = holdEndsAt !== null && holdEndsAt <= new Date();
  // ссылка креатора в шапке профиля — такой же пункт сверки, как требования к ролику
  const bioLink = video.order.bioLink ?? 'ссылка креатора';
  const parts = [
    ...videoFormatParts(video.order),
    ...(video.order.linkInBio ? [`Ссылка в шапке профиля: ${bioLink}`] : []),
  ];
  const author = video.author;
  const authorLink = safeUrl(author.url) && (
    <a href={safeUrl(author.url)} target="_blank" rel="noopener noreferrer">
      {author.name || 'аккаунт'}
    </a>
  );
  const canEditViews = video.status === 'SUBMITTED' || holdEndsAt !== null;

  return (
    <div className={s.page}>
      <header>
        <p className={s.hint}>
          <Link to={`/mod/creators/${video.creatorId}`}>{video.creator}</Link> ·
          видео {video.attempt}
          {video.submittedAt && ` · ${timeAgo(video.submittedAt)}`}
        </p>
        <h1>{video.order.title}</h1>
        {video.order.termsBeforeEdit && (
          <p className={s.hint}>
            Ролик сдан до правки заказа — ниже прежние условия, проверяйте по
            ним.
          </p>
        )}
      </header>

      <div className={s.review}>
        <div className={s.page}>
          {safeUrl(video.videoUrl) ? (
            <a
              href={safeUrl(video.videoUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className={s.videoLink}
            >
              <PlatformIcon platform={video.platform} size={44} inverse />
              <span>
                <strong>
                  Открыть ролик
                  {video.platform !== 'OTHER' &&
                    ` в ${PLATFORM_NAMES[video.platform]}`}
                </strong>
                <small>{video.videoUrl}</small>
              </span>
            </a>
          ) : (
            <p className={s.hint}>
              Ссылка на видео некорректна: {video.videoUrl}
            </p>
          )}

          <p
            className={author.status === 'verified' ? s.notice : s.alert}
            role={author.status === 'verified' ? undefined : 'alert'}
          >
            {author.status === 'verified' ? (
              <>
                Автор подтверждён: ролик с подключённого аккаунта креатора
                {author.connectedDaysAgo !== null &&
                  `. Аккаунт подключён ${author.connectedDaysAgo === 0 ? 'сегодня' : `${author.connectedDaysAgo} дн. назад`} — если ролик чужой и популярный, уточните у креатора через поддержку`}
              </>
            ) : author.status === 'inProfile' ? (
              <>
                Автор — {authorLink}, есть в соцсетях креатора. Владение не
                подтверждено: ссылки креатор указал сам
              </>
            ) : author.status === 'mismatch' ? (
              <>
                Автор — {authorLink}, его нет в соцсетях креатора — проверьте,
                что ролик его
              </>
            ) : (
              <>
                Авторство не проверено — сверьте аккаунт ролика с соцсетями
                креатора
              </>
            )}
          </p>

          <section className={s.card}>
            <h2>
              Сверьте с заданием
              {parts.length > 0 && ` · ${checked.size} из ${parts.length}`}
            </h2>
            {parts.map((part) => (
              <label key={part} className={s.check}>
                <input
                  type="checkbox"
                  checked={checked.has(part)}
                  onChange={() => toggleCheck(part)}
                />
                <span>{part}</span>
              </label>
            ))}
            <details open={!parts.length}>
              <summary>Текст задания</summary>
              <div className={s.text}>{video.order.description}</div>
            </details>
            {video.order.exampleUrls.length > 0 && (
              <details>
                <summary>
                  Примеры роликов · {video.order.exampleUrls.length}
                </summary>
                <ol>
                  {video.order.exampleUrls.map((url) => (
                    <li key={url}>
                      {safeUrl(url) ? (
                        <a
                          href={safeUrl(url)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {url}
                        </a>
                      ) : (
                        url
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>

          <section className={s.rows}>
            <div className={s.row}>
              <span>Ставка</span>
              <span>{formatCpm(video.order.cpm)}</span>
            </div>
            <div className={s.row}>
              <span>Порог</span>
              <span>от {formatViews(video.order.minViews)} просмотров</span>
            </div>
            <div className={s.row}>
              <span>Свободно в бюджете</span>
              <span>{formatMoney(video.order.free)}</span>
            </div>
            {video.agreedPayout !== null && (
              <div className={s.row}>
                <span>Не влез в бюджет — креатор согласился на остаток</span>
                <span>{formatMoney(video.agreedPayout)}</span>
              </div>
            )}
            {video.autoViews !== null && (
              <div className={s.row}>
                <span>Сейчас по данным {PLATFORM_NAMES[video.platform]}</span>
                <span>{formatViews(video.autoViews)} просмотров</span>
              </div>
            )}
            {video.views !== null && (
              <div className={s.row}>
                <span>
                  {video.status === 'SUBMITTED'
                    ? 'Креатор указал'
                    : 'Зафиксировано'}
                </span>
                <span>
                  {formatViews(video.views)} просмотров ·{' '}
                  {formatMoney(video.payout)}
                </span>
              </div>
            )}
          </section>
        </div>

        <aside className={`${s.card} ${s.decision}`}>
          {canEditViews && (
            <>
              <label className={s.field}>
                <span>
                  {video.status === 'SUBMITTED'
                    ? 'Просмотров по ссылке'
                    : 'Итог просмотров'}
                </span>
                <input
                  value={views}
                  onChange={(e) => setViews(e.target.value)}
                  type="number"
                  min="1"
                  step="1"
                />
              </label>
              {estimate && (
                <p className={`${s.hint} ${s.small}`}>
                  К начислению: {estimate} (не больше остатка бюджета)
                </p>
              )}
              <label className={s.field}>
                <span>Лайков — по желанию, для отчёта</span>
                <input
                  value={likes}
                  onChange={(e) => setLikes(e.target.value)}
                  type="number"
                  min="0"
                  step="1"
                />
              </label>
            </>
          )}

          {video.status === 'SUBMITTED' && video.inflatedBefore > 0 && (
            <p className={s.dangerNote} role="status">
              Уже отклоняли за завышенные просмотры: {video.inflatedBefore}.
              Повтор — повод для бана.
            </p>
          )}
          {inflated && (
            <p className={s.dangerNote} role="status">
              Меньше половины указанных креатором ({formatViews(video.views!)})
              — это завышение. Ролик отклоняется, и сдать его снова будет
              нельзя.
            </p>
          )}

          {video.status === 'SUBMITTED' ? (
            rejecting ? (
              <>
                <ReasonPicker
                  value={comment}
                  onChange={setComment}
                  presets={PRESETS}
                />
                {error && (
                  <p className={s.error} role="alert">
                    {error}
                  </p>
                )}
                <div className={s.buttons}>
                  <button
                    type="button"
                    className={s.btn}
                    disabled={busy}
                    onClick={() => setRejecting(false)}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className={`${s.btn} ${s.rejectSolid}`}
                    disabled={busy || !comment.trim()}
                    onClick={() => decide('reject')}
                  >
                    Отклонить
                  </button>
                </div>
              </>
            ) : (
              <>
                {error && (
                  <p className={s.error} role="alert">
                    {error}
                  </p>
                )}
                <div className={s.buttons}>
                  {inflated ? (
                    <button
                      type="button"
                      className={`${s.btn} ${s.rejectSolid}`}
                      disabled={busy}
                      onClick={() => decide('inflated')}
                    >
                      Завышены просмотры
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${s.btn} ${s.approve}`}
                      disabled={busy || !Number(views)}
                      onClick={() => decide('approve')}
                    >
                      Одобрить{estimate && ` · ${estimate}`}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${s.btn} ${s.reject}`}
                    disabled={busy}
                    onClick={() => setRejecting(true)}
                  >
                    Отклонить
                  </button>
                </div>
              </>
            )
          ) : holdOver ? (
            <>
              <p className={`${s.hint} ${s.small}`}>
                Холд закончился: откройте публикацию и зафиксируйте итог —
                просмотры попадут в отчёт рекламодателю (оплата не меняется), а
                деньги за ролик станут доступны к выводу. Публикации нет —
                отмените начисление.
                {video.order.linkInBio &&
                  ` Заказ требует ссылку в шапке профиля — проверьте и её: ${bioLink}.`}
              </p>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              <div className={s.buttons}>
                <button
                  type="button"
                  className={`${s.btn} ${s.approve}`}
                  disabled={busy || !Number(views)}
                  onClick={finalize}
                >
                  Зафиксировать итог
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.reject}`}
                  disabled={busy}
                  onClick={() => deleted(false)}
                >
                  Публикация удалена
                </button>
                {video.order.linkInBio && (
                  <button
                    type="button"
                    className={`${s.btn} ${s.reject}`}
                    disabled={busy}
                    onClick={() => deleted(true)}
                  >
                    Ссылки в шапке нет
                  </button>
                )}
              </div>
            </>
          ) : holdEndsAt ? (
            <p className={s.hint}>
              Одобрено. Конец холда — {formatDate(holdEndsAt.toISOString())}.
            </p>
          ) : (
            <p className={s.hint}>Это видео уже проверено.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Ролик по отдельному адресу (из журнала, истории, заказа); после решения — в очередь. */
export function VideoPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  return (
    <VideoReview
      key={id}
      id={id}
      onDone={(tab) => void navigate(`/mod?tab=${tab}`, { replace: true })}
    />
  );
}
