import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import {
  ApiError,
  type Balance,
  banUser,
  connectSocialAccount,
  type CreatorProfile,
  disconnectSocialAccount,
  fetchBalance,
  fetchCreator,
  fetchMyProfile,
  fetchSocialAccounts,
  removeReview,
  type SocialAccount,
  unbanUser,
  updateNotifications,
  updateProfileLinks,
  updateWallet,
} from '../api';
import AppSettings from '../components/AppSettings';
import LoadState from '../components/LoadState';
import ModHistory from '../components/ModHistory';
import PlatformIcon from '../components/PlatformIcon';
import UserAvatar from '../components/UserAvatar';
import { describeVideoUrl, formatDate, formatMoney } from '../format';
import { confirmAction, openExternalLink, safeUrl } from '../telegram';
import s from './ProfileView.module.css';

// Ссылки на соцсети — списком: на одной площадке может быть несколько аккаунтов (до 10).
const MAX_LINKS = 10;
/** Площадка и короткий вид ссылки — для знака и подписи; не распознали — без знака. */
const linkView = (url: string) =>
  describeVideoUrl(url) ?? { platform: 'OTHER' as const, short: url };
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

export default function ProfileView() {
  const { t } = useTranslation();
  // Без id — свой профиль (/profile, ссылки можно редактировать); с id — чужой, только просмотр.
  const { id } = useParams();
  /** В окне модератора (/mod/creators/:id) отзывы можно удалять. */
  const moderator = useLocation().pathname.startsWith('/mod');
  const own = !id;

  const [profile, setProfile] = useState<CreatorProfile>();
  const [loadError, setLoadError] = useState('');
  const [balance, setBalance] = useState<Balance>();

  const [links, setLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const p = own ? await fetchMyProfile() : await fetchCreator(Number(id));
      setProfile(p);
      setLinks([...p.links]);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.userMessage : t('profile.loadError'),
      );
    }
  }, [own, id, t]);
  useEffect(() => void load(), [load]);

  // баланс — второстепенное: не загрузился — просто не показываем
  useEffect(() => {
    if (own) fetchBalance().then(setBalance, () => {});
  }, [own]);

  const shownLinks = (profile?.links ?? []).filter((l) => safeUrl(l));

  function addLink() {
    const url = newLink.trim();
    if (url && !links.includes(url)) setLinks([...links, url]);
    setNewLink('');
  }
  function startLinks() {
    setLinks([...(profile?.links ?? [])]);
    setNewLink('');
    setError('');
    setEditing(true);
  }

  async function saveLinks(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // недописанная ссылка в поле — тоже сохраняем, а не теряем молча
      await updateProfileLinks(
        newLink.trim() ? [...links, newLink.trim()] : links,
      );
      setEditing(false);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('profile.saveError'),
      );
    } finally {
      setBusy(false);
    }
  }

  // Кошелёк для выплат — только в своём профиле.
  const [editingWallet, setEditingWallet] = useState(false);
  const [wallet, setWallet] = useState('');
  const [walletError, setWalletError] = useState('');

  function startWallet() {
    setWallet(profile?.wallet ?? '');
    setWalletError('');
    setEditingWallet(true);
  }

  async function saveWallet(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setWalletError('');
    try {
      await updateWallet(wallet.trim());
      setEditingWallet(false);
      await load();
    } catch (err) {
      setWalletError(
        err instanceof ApiError ? err.userMessage : t('profile.saveError'),
      );
    } finally {
      setBusy(false);
    }
  }

  // Подключённые аккаунты площадок — только в своём профиле. Пусто — ни одна площадка не включена.
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountsError, setAccountsError] = useState('');
  const loadAccounts = useCallback(
    () => fetchSocialAccounts().then(setAccounts, () => {}),
    [],
  );
  useEffect(() => {
    if (!own) return;
    void loadAccounts();
    // вход на площадке идёт во внешнем браузере — вернулись в Telegram, обновляем статус
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadAccounts();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [own, loadAccounts]);

  async function connectAccount(a: SocialAccount) {
    setAccountsError('');
    try {
      openExternalLink((await connectSocialAccount(a.platform)).url);
    } catch (err) {
      setAccountsError(
        err instanceof ApiError ? err.userMessage : t('profile.connectError'),
      );
    }
  }

  async function disconnectAccount(
    a: SocialAccount,
    account: SocialAccount['accounts'][number],
  ) {
    const name = account.label ? `${a.name} ${account.label}` : a.name;
    if (!(await confirmAction(t('profile.disconnectConfirm', { name }))))
      return;
    setAccountsError('');
    try {
      await disconnectSocialAccount(account.id);
      await loadAccounts();
    } catch (err) {
      setAccountsError(
        err instanceof ApiError
          ? err.userMessage
          : t('profile.disconnectError'),
      );
    }
  }

  const [notifyError, setNotifyError] = useState('');
  async function toggleNewOrders(checked: boolean) {
    setNotifyError('');
    try {
      await updateNotifications(checked);
      setProfile((p) => p && { ...p, notifyNewOrders: checked });
    } catch (err) {
      setNotifyError(
        err instanceof ApiError ? err.userMessage : t('profile.saveError'),
      );
    }
  }

  async function remove(submissionId: number) {
    if (!(await confirmAction(t('profile.removeReviewConfirm')))) return;
    try {
      await removeReview(submissionId);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.userMessage
          : t('profile.removeReviewError'),
      );
    }
  }

  // Блокировка — только в окне модератора.
  const [banning, setBanning] = useState(false);
  const [banReason, setBanReason] = useState('');

  async function ban() {
    if (!(await confirmAction(t('profile.banConfirm')))) return;
    setBusy(true);
    setError('');
    try {
      await banUser(profile!.id, banReason);
      setBanning(false);
      setBanReason('');
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('profile.banError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function unban() {
    if (!(await confirmAction(t('profile.unbanConfirm')))) return;
    try {
      await unbanUser(profile!.id);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.userMessage : t('profile.unbanError'),
      );
    }
  }

  if (loadError || !profile)
    return (
      <main className={s.page}>
        <LoadState error={loadError} onRetry={load} />
      </main>
    );

  return (
    <main className={s.page}>
      <header className={s.head}>
        <UserAvatar userId={profile.id} name={profile.name} size={72} />
        <div className={s.who}>
          <span className={s.hint}>
            {own ? t('profile.mine') : t('profile.creator')}
          </span>
          <h1>{profile.name}</h1>
        </div>
      </header>

      {moderator && (
        <section className={s.ban}>
          {profile.ban ? (
            <>
              <p>
                <strong>{t('profile.banned')}</strong>{' '}
                {formatDate(profile.ban.at)}
                {profile.ban.reason && `: ${profile.ban.reason}`}
              </p>
              <button type="button" className={s.edit} onClick={unban}>
                {t('profile.unban')}
              </button>
            </>
          ) : banning ? (
            <>
              <label className="field-label">
                <span>{t('profile.banReasonLabel')}</span>
                <textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder={t('profile.banReason')}
                />
              </label>
              <div className={s.buttons}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setBanning(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className={s.danger}
                  disabled={busy || !banReason.trim()}
                  onClick={ban}
                >
                  {t('profile.ban')}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className={s.remove}
              onClick={() => setBanning(true)}
            >
              {t('profile.banUser')}
            </button>
          )}
        </section>
      )}
      {moderator && (
        <ModHistory userId={profile.id} version={profile.ban?.at ?? 'active'} />
      )}

      {/* Свой профиль — тремя группами: деньги, что видят заказчики, настройки. Чужой — только витрина. */}
      {own && (
        <>
          <h2 className={s.group}>{t('profile.groupPayouts')}</h2>
          {balance && (
            <Link to="/balance" className={s.balance}>
              <span>
                <small>{t('submissions.balance')}</small>
                <strong>{formatMoney(balance.available)}</strong>
                {!!balance.held && (
                  <small>
                    {t('submissions.heldShort', {
                      amount: formatMoney(balance.held),
                    })}
                  </small>
                )}
              </span>
              <span className={s.balanceAction}>
                {t('submissions.withdraw')}
              </span>
            </Link>
          )}
          <section className={s.block}>
            <h2 className="section-title">{t('profile.walletTitle')}</h2>
            {editingWallet ? (
              <form className={s.linksForm} onSubmit={saveWallet}>
                <label>
                  <span>{t('profile.walletLabel')}</span>
                  <input
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    maxLength={64}
                    placeholder="T…"
                  />
                </label>
                <p className={s.hint}>{t('profile.walletHint')}</p>
                {walletError && (
                  <p className={s.error} role="alert">
                    {walletError}
                  </p>
                )}
                <div className={s.buttons}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditingWallet(false)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button type="submit" className={s.primary} disabled={busy}>
                    {t('common.save')}
                  </button>
                </div>
              </form>
            ) : profile.wallet ? (
              <>
                <p className={s.wallet}>{profile.wallet}</p>
                <button type="button" className={s.edit} onClick={startWallet}>
                  {t('profile.walletChange')}
                </button>
              </>
            ) : (
              // без кошелька вывести нельзя — заметно, с кнопкой, а не серой строкой
              <div className={s.walletCta}>
                <strong>{t('profile.walletEmpty')}</strong>
                <button
                  type="button"
                  className="main-button"
                  onClick={startWallet}
                >
                  {t('profile.walletAddCta')}
                </button>
              </div>
            )}
          </section>

          <h2 className={s.group}>{t('profile.groupPublic')}</h2>
          <p className={`${s.hint} ${s.groupHint}`}>
            {t('profile.groupPublicHint')}
          </p>
        </>
      )}
      <div className={s.tiles}>
        <div className={s.tile}>
          <strong>{profile.rating ?? '—'}</strong>
          <span>
            {profile.reviewsCount
              ? t('profile.ratingReviews', { count: profile.reviewsCount })
              : t('profile.noReviewsYet')}
          </span>
        </div>
        <div className={s.tile}>
          <strong>{profile.completed}</strong>
          <span>{t('profile.approved')}</span>
        </div>
      </div>
      <section className={s.block}>
        <h2 className="section-title">{t('profile.linksTitle')}</h2>
        {editing ? (
          <form className={s.linksForm} onSubmit={saveLinks}>
            {links.map((l, i) => (
              <div key={l} className={s.linkRow}>
                <PlatformIcon platform={linkView(l).platform} size={32} />
                <span className={s.linkText}>{linkView(l).short}</span>
                <button
                  type="button"
                  className={s.linkRemove}
                  aria-label={t('profile.removeLink')}
                  onClick={() => setLinks(links.filter((_, j) => j !== i))}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
            {links.length < MAX_LINKS && (
              <div className={s.linkAdd}>
                <label className="visually-hidden" htmlFor="new-link">
                  {t('profile.linkPlaceholder')}
                </label>
                <input
                  id="new-link"
                  value={newLink}
                  onChange={(e) => setNewLink(e.target.value)}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder={t('profile.linkPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addLink();
                  }}
                />
                <button
                  type="button"
                  className={s.linkAddButton}
                  disabled={!newLink.trim()}
                  onClick={addLink}
                >
                  {t('profile.addLink')}
                </button>
              </div>
            )}
            <p className={s.hint}>{t('profile.linksHint')}</p>
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <div className={s.buttons}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className={s.primary} disabled={busy}>
                {t('common.save')}
              </button>
            </div>
          </form>
        ) : (
          <>
            {shownLinks.length ? (
              <div className={s.links}>
                {shownLinks.map((l) => (
                  <a
                    key={l}
                    href={safeUrl(l)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <PlatformIcon
                      platform={linkView(l).platform}
                      size={24}
                      round
                    />
                    {linkView(l).short}
                  </a>
                ))}
              </div>
            ) : (
              <p className={s.hint}>{t('profile.linksEmpty')}</p>
            )}
            {own && (
              <button type="button" className={s.edit} onClick={startLinks}>
                {shownLinks.length
                  ? t('profile.linksChange')
                  : t('profile.linksAdd')}
              </button>
            )}
          </>
        )}
      </section>
      {profile.portfolio.length > 0 && (
        <section className={s.block}>
          <h2 className="section-title">{t('profile.portfolio')}</h2>
          {/* рекламодателю ссылки не приходят (ведут на аккаунт креатора) — только названия работ */}
          {profile.portfolio.map((p) =>
            safeUrl(p.videoUrl) ? (
              <a
                key={p.submissionId}
                href={safeUrl(p.videoUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className={s.item}
              >
                <span className={s.play} aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M8 5.5v13l11-6.5z" />
                  </svg>
                </span>
                <span>{p.orderTitle ?? t('profile.otherOrder')}</span>
              </a>
            ) : (
              <div key={p.submissionId} className={s.item}>
                <span className={`${s.play} ${s.done}`} aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                </span>
                <span>{p.orderTitle ?? t('profile.otherOrder')}</span>
              </div>
            ),
          )}
        </section>
      )}
      <section className={s.block}>
        <h2 className="section-title">{t('profile.reviews')}</h2>
        {!profile.reviews.length && (
          <p className={s.hint}>{t('profile.noReviews')}</p>
        )}
        {profile.reviews.map((r) => (
          <article key={r.submissionId} className={s.review}>
            <div className={s.reviewTop}>
              <span
                className={s.stars}
                aria-label={t('profile.stars', { rating: r.rating })}
              >
                {stars(r.rating)}
              </span>
              {r.decidedAt && (
                <span className={s.hint}>{formatDate(r.decidedAt)}</span>
              )}
            </div>
            {r.review && <p className={s.reviewText}>{r.review}</p>}
            <span className={s.hint}>
              {r.orderTitle ?? t('profile.otherOrder')}
            </span>
            {moderator ? (
              <button
                type="button"
                className={s.remove}
                onClick={() => remove(r.submissionId)}
              >
                {t('profile.removeReview')}
              </button>
            ) : (
              own && (
                <Link
                  to={`/report?${new URLSearchParams({
                    target: 'REVIEW',
                    id: String(r.submissionId),
                    ...(r.orderTitle ? { title: r.orderTitle } : {}),
                  })}`}
                  className={`quiet-link ${s.start}`}
                >
                  {t('profile.reportReview')}
                </Link>
              )
            )}
          </article>
        ))}
        {error && !editing && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </section>

      {own && (
        <>
          <h2 className={s.group}>{t('profile.groupSettings')}</h2>
          {accounts.length > 0 && (
            <section className={s.block}>
              <h2 className="section-title">{t('profile.accountsTitle')}</h2>
              <p className={s.hint}>{t('profile.accountsHint')}</p>
              {accounts.map((a) => (
                <Fragment key={a.platform}>
                  {a.accounts.map((acc) => (
                    <div
                      key={acc.id}
                      className={`${s.switchRow} ${s.accountRow}`}
                    >
                      <PlatformIcon platform={a.platform} size={40} />
                      <span>
                        {a.name}
                        {acc.label ? ` · ${acc.label}` : ''}
                        <small>{t('profile.connected')}</small>
                      </span>
                      <button
                        type="button"
                        className={`${s.accountAction} ${s.quiet}`}
                        onClick={() => disconnectAccount(a, acc)}
                      >
                        {t('profile.disconnect')}
                      </button>
                    </div>
                  ))}
                  {!a.accounts.length ? (
                    <div className={`${s.switchRow} ${s.accountRow}`}>
                      <PlatformIcon platform={a.platform} size={40} />
                      <span>
                        {a.name}
                        <small>{t('profile.notConnected')}</small>
                      </span>
                      <button
                        type="button"
                        className={s.accountAction}
                        onClick={() => connectAccount(a)}
                      >
                        {t('profile.connect')}
                      </button>
                    </div>
                  ) : (
                    a.canAdd && (
                      <button
                        type="button"
                        className={s.addAccount}
                        onClick={() => connectAccount(a)}
                      >
                        {t('profile.addAccount', { name: a.name })}
                      </button>
                    )
                  )}
                </Fragment>
              ))}
              {accountsError && (
                <p className={s.error} role="alert">
                  {accountsError}
                </p>
              )}
            </section>
          )}
          <section className={s.block}>
            <h2 className="section-title">{t('profile.notificationsTitle')}</h2>
            <label className={s.switchRow}>
              <span>
                {t('profile.newOrders')}
                <small>{t('profile.newOrdersHint')}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={profile.notifyNewOrders ?? true}
                onChange={(e) => void toggleNewOrders(e.target.checked)}
              />
            </label>
            {notifyError && (
              <p className={s.error} role="alert">
                {notifyError}
              </p>
            )}
          </section>
          <AppSettings />
        </>
      )}

      {!own && !moderator && (
        <Link
          to={`/report?${new URLSearchParams({ target: 'PROFILE', id: String(profile.id), title: profile.name })}`}
          className="quiet-link"
        >
          {t('profile.reportProfile')}
        </Link>
      )}
    </main>
  );
}
