import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ApiError,
  fetchModQueue,
  fetchModVideo,
  finalizeVideo,
  markPublicationDeleted,
  type ModVideo,
  moderateVideo,
  PLATFORM_NAMES,
} from '../../api';
import PlatformIcon from '../../components/PlatformIcon';
import ReasonPicker from '../../components/ReasonPicker';
import {
  formatCpm,
  formatDate,
  formatMoney,
  formatViews,
  timeAgo,
  videoFormatParts,
} from '../../format';
import { confirmAction, safeUrl } from '../../telegram';
import s from './ModVideoView.module.css';

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

const warnIcon = (
  <svg
    className={s.icon}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);

export default function ModVideoView() {
  const id = Number(useParams().id);
  const navigate = useNavigate();

  const [video, setVideo] = useState<ModVideo>();
  const [loadError, setLoadError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Нажали «Отклонить» — показываем причины; одобрить или отклонить без причины нельзя спутать. */
  const [rejecting, setRejecting] = useState(false);
  /** Сверка с требованиями заказа — памятка модератору, одобрить можно и без всех галочек. */
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
      // Просмотры из API площадки точнее заявленных — подставляем их.
      setViews(String(v.autoViews ?? v.views ?? ''));
      setLikes(String(v.autoLikes ?? v.likes ?? ''));
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не удалось загрузить видео',
      );
    }
  }, [id]);
  // экран пересоздаётся на каждый ролик (ключ по адресу в App.tsx) — загружаем один раз
  useEffect(() => void load(), [load]);

  function toggleCheck(item: string) {
    const next = new Set(checked);
    if (!next.delete(item)) next.add(item);
    setChecked(next);
  }

  /** После решения — следующее из той же очереди (проверка или итог холда); пуста — назад к ней. */
  async function goNext(tab: 'videos' | 'holds') {
    const next = (await fetchModQueue().catch(() => undefined))?.[tab].find(
      (v) => v.id !== id,
    );
    await navigate(next ? `/mod/videos/${next.id}` : `/mod?tab=${tab}`, {
      replace: true,
    });
  }

  async function run(action: () => Promise<unknown>, tab: 'videos' | 'holds') {
    setBusy(true);
    setError('');
    try {
      await action();
      await goNext(tab);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.userMessage
          : 'Не получилось, попробуйте ещё раз',
      );
    } finally {
      setBusy(false);
    }
  }

  const decide = (decision: 'approve' | 'reject') =>
    run(
      () =>
        moderateVideo(
          id,
          decision,
          decision === 'reject'
            ? { comment }
            : { views: Number(views), likes: likesOrNull() },
        ),
      'videos',
    );
  const finalize = () =>
    run(() => finalizeVideo(id, Number(views), likesOrNull()), 'holds');
  async function deleted() {
    if (
      !(await confirmAction(
        'Публикации нет по ссылке? Начисление за ролик отменится, деньги вернутся в бюджет заказа.',
      ))
    )
      return;
    await run(() => markPublicationDeleted(id), 'holds');
  }

  if (loadError)
    return (
      <main className={s.page}>
        <p className={s.hint}>{loadError}</p>
      </main>
    );
  if (!video)
    return (
      <main className={s.page}>
        <p className={s.hint}>Загрузка…</p>
      </main>
    );

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
  const parts = videoFormatParts(video.order);
  const author = video.author;
  const authorLink = safeUrl(author.url) && (
    <a href={safeUrl(author.url)} target="_blank" rel="noopener noreferrer">
      {author.name || 'аккаунт'}
    </a>
  );

  return (
    <main className={s.page}>
      <header className={s.head}>
        <span className={s.hint}>
          <Link to={`/mod/creators/${video.creatorId}`}>{video.creator}</Link> ·
          видео {video.attempt}
          {video.submittedAt && ` · ${timeAgo(video.submittedAt)}`}
        </span>
        <h1>{video.order.title}</h1>
        {video.order.termsBeforeEdit && (
          <p className={s.hint}>
            Ролик сдан до правки заказа — ниже прежние условия, проверяйте по
            ним.
          </p>
        )}
      </header>

      {safeUrl(video.videoUrl) ? (
        <a
          href={safeUrl(video.videoUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className={s.video}
        >
          <PlatformIcon platform={video.platform} size={48} inverse />
          <span className={s.link}>
            <strong>
              Открыть ролик
              {video.platform !== 'OTHER'
                ? ` в ${PLATFORM_NAMES[video.platform]}`
                : ''}
            </strong>
            <span className={s.url}>{video.videoUrl}</span>
          </span>
        </a>
      ) : (
        <p className={s.hint}>Ссылка на видео некорректна: {video.videoUrl}</p>
      )}

      <p
        className={`${s.author} ${s[author.status] ?? ''}`}
        role={author.status === 'verified' ? undefined : 'alert'}
      >
        {author.status === 'verified' ? (
          <>
            <svg
              className={s.icon}
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
              <path d="M8.5 12l2.5 2.5 4.5-5" />
            </svg>
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
            {warnIcon}
            Автор — {authorLink}, его нет в соцсетях креатора — проверьте, что
            ролик его
          </>
        ) : (
          <>
            {warnIcon}
            Авторство не проверено — сверьте аккаунт ролика с соцсетями креатора
          </>
        )}
      </p>

      <section className={s.block}>
        <h2 className="section-title">
          Сверьте с заданием
          {parts.length > 0 && ` · ${checked.size} из ${parts.length}`}
        </h2>
        {parts.length > 0 && (
          <div className={s.checks}>
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
          </div>
        )}
        {/* текст задания длинный — свёрнут, требования выше видны сразу */}
        <details className={s.task} open={!parts.length}>
          <summary>Текст задания</summary>
          <div className={s.text}>{video.order.description}</div>
        </details>
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

      {(video.status === 'SUBMITTED' || holdEndsAt) && (
        <>
          <label className={s.views}>
            <span className="section-title">
              {video.status === 'SUBMITTED'
                ? 'Просмотров по ссылке'
                : 'Итог просмотров'}
            </span>
            <input
              value={views}
              onChange={(e) => setViews(e.target.value)}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
            />
            {estimate && (
              <span className={s.hint}>
                К начислению за эти просмотры: {estimate} (не больше остатка
                бюджета)
              </span>
            )}
          </label>
          <label className={s.views}>
            <span className="section-title">
              Лайков — по желанию, для отчёта рекламодателю
            </span>
            <input
              value={likes}
              onChange={(e) => setLikes(e.target.value)}
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
            />
          </label>
        </>
      )}

      {video.status === 'SUBMITTED' ? (
        <>
          {/* причины — только когда решили отклонить: так «Отклонить» не нажать по ошибке */}
          {rejecting && (
            <ReasonPicker
              id="reasons"
              value={comment}
              onChange={setComment}
              presets={PRESETS}
            />
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}

          {rejecting ? (
            <div className={`bottom-bar ${s.two}`}>
              <button
                type="button"
                className={s.secondary}
                disabled={busy}
                onClick={() => setRejecting(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className={s.rejectConfirm}
                disabled={busy || !comment.trim()}
                onClick={() => decide('reject')}
              >
                Отклонить
              </button>
            </div>
          ) : (
            <div className={`bottom-bar ${s.two}`}>
              <button
                type="button"
                className={s.reject}
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                Отклонить
              </button>
              <button
                type="button"
                className={s.approve}
                disabled={busy || !Number(views)}
                onClick={() => decide('approve')}
              >
                Одобрить{estimate && ` · ${estimate}`}
              </button>
            </div>
          )}
        </>
      ) : holdEndsAt && holdEndsAt <= new Date() ? (
        <>
          <p className={s.hint}>
            Холд закончился: откройте публикацию и зафиксируйте итог — просмотры
            попадут в отчёт рекламодателю (оплата не меняется), а деньги за
            ролик станут доступны к выводу. Публикации нет — отмените
            начисление.
          </p>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={`bottom-bar ${s.two}`}>
            <button
              type="button"
              className={s.reject}
              disabled={busy}
              onClick={deleted}
            >
              Публикация удалена
            </button>
            <button
              type="button"
              className={s.approve}
              disabled={busy || !Number(views)}
              onClick={finalize}
            >
              Зафиксировать итог
            </button>
          </div>
        </>
      ) : holdEndsAt ? (
        <p className={s.hint}>
          Одобрено. Конец холда — {formatDate(holdEndsAt.toISOString())}.
        </p>
      ) : (
        <p className={s.hint}>Это видео уже проверено.</p>
      )}
    </main>
  );
}
