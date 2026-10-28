import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  type Balance,
  type CreatorProfile,
  disconnectSocialAccount,
  errorText,
  fetchBalance,
  fetchCreator,
  fetchMyProfile,
  fetchSocialAccounts,
  safeUrl,
  type SocialAccount,
  updateNotifications,
  updateProfileLinks,
  updateWallet,
} from '../api';
import { Avatar } from '../components/Avatar';
import { Complaint } from '../components/Complaint';
import { LanguagePicker } from '../components/LanguagePicker';
import { PlatformIcon } from '../components/PlatformIcon';
import { describeVideoUrl, formatDate, formatMoney } from '../format';
import s from '../ui.module.css';

// Ссылки на соцсети — списком: на одной площадке может быть несколько аккаунтов (до 10).
const MAX_LINKS = 10;
/** Площадка и короткий вид ссылки — для знака и подписи; не распознали — без знака. */
const linkView = (url: string) =>
  describeVideoUrl(url) ?? { platform: 'OTHER' as const, short: url };
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/**
 * Профиль креатора — как в мини-аппе (webapp/src/views/ProfileView.tsx). Без id (/profile) — свой:
 * кошелёк, соцсети, уведомления, язык; с id (/creators/:id) — чужой, только витрина и жалоба.
 * Подключать аккаунты площадок — в мини-аппе: возврат после входа на площадке настроен на её домен.
 */
export function Profile() {
  const { t } = useTranslation();
  const { id } = useParams();
  const own = !id;

  const [profile, setProfile] = useState<CreatorProfile>();
  const [loadError, setLoadError] = useState('');
  const [balance, setBalance] = useState<Balance>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setProfile(own ? await fetchMyProfile() : await fetchCreator(Number(id)));
    } catch (err) {
      setLoadError(errorText(err, t('profile.loadError')));
    }
  }, [own, id, t]);
  useEffect(() => void load(), [load]);

  // баланс и аккаунты — второстепенное: не загрузились — просто не показываем
  useEffect(() => {
    if (own) fetchBalance().then(setBalance, () => {});
  }, [own]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountsError, setAccountsError] = useState('');
  const loadAccounts = useCallback(
    () => fetchSocialAccounts().then(setAccounts, () => {}),
    [],
  );
  useEffect(() => {
    if (own) void loadAccounts();
  }, [own, loadAccounts]);

  // Ссылки на соцсети
  const [editingLinks, setEditingLinks] = useState(false);
  const [links, setLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState('');
  const [linksError, setLinksError] = useState('');
  function addLink() {
    const url = newLink.trim();
    if (url && !links.includes(url)) setLinks([...links, url]);
    setNewLink('');
  }
  async function saveLinks(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLinksError('');
    try {
      // недописанная ссылка в поле — тоже сохраняем, а не теряем молча
      await updateProfileLinks(
        newLink.trim() ? [...links, newLink.trim()] : links,
      );
      setEditingLinks(false);
      await load();
    } catch (err) {
      setLinksError(errorText(err, t('profile.saveError')));
    } finally {
      setBusy(false);
    }
  }

  // Кошелёк — со свежего входа: если вход старше часа, API попросит войти заново (окно в App.tsx)
  const [editingWallet, setEditingWallet] = useState(false);
  const [wallet, setWallet] = useState('');
  const [walletError, setWalletError] = useState('');
  async function saveWallet(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setWalletError('');
    try {
      await updateWallet(wallet.trim());
      setEditingWallet(false);
      await load();
    } catch (err) {
      setWalletError(errorText(err, t('profile.saveError')));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(
    a: SocialAccount,
    account: SocialAccount['accounts'][number],
  ) {
    const name = account.label ? `${a.name} ${account.label}` : a.name;
    if (!window.confirm(t('profile.disconnectConfirm', { name }))) return;
    setAccountsError('');
    try {
      await disconnectSocialAccount(account.id);
      await loadAccounts();
    } catch (err) {
      setAccountsError(errorText(err, t('profile.disconnectError')));
    }
  }

  const [notifyError, setNotifyError] = useState('');
  async function toggleNewOrders(checked: boolean) {
    setNotifyError('');
    try {
      await updateNotifications(checked);
      setProfile((p) => p && { ...p, notifyNewOrders: checked });
    } catch (err) {
      setNotifyError(errorText(err, t('profile.saveError')));
    }
  }

  if (loadError)
    return (
      <div className={s.buttons}>
        <p className={s.hint}>{loadError}</p>
        <button type="button" className={s.btn} onClick={load}>
          {t('common.retry')}
        </button>
      </div>
    );
  if (!profile) return <p className={s.hint}>{t('common.loading')}</p>;

  const shownLinks = profile.links.filter((l) => safeUrl(l));
  const connected = accounts.flatMap((a) =>
    a.accounts.map((acc) => ({ a, acc })),
  );

  return (
    <div className={s.page}>
      <header className={s.check}>
        <Avatar userId={profile.id} name={profile.name} size={64} />
        <span>
          <span className={`${s.hint} ${s.block}`}>
            {own ? t('profile.mine') : t('profile.creator')}
          </span>
          <h1>{profile.name}</h1>
        </span>
      </header>

      {/* своё — две колонки (витрина и настройки), чужое — одна */}
      <div className={own ? s.review : s.page}>
        {/* витрина — то, что видят заказчики */}
        <div className={s.page}>
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
          {own && (
            <p className={`${s.hint} ${s.small}`}>
              {t('profile.groupPublicHint')}
            </p>
          )}

          <section className={s.card}>
            <h2>{t('profile.linksTitle')}</h2>
            {editingLinks ? (
              <form className={s.fieldset} onSubmit={saveLinks}>
                {links.map((l, i) => (
                  <div key={l} className={s.inputRow}>
                    <span className={s.check}>
                      <PlatformIcon
                        platform={linkView(l).platform}
                        size={24}
                        round
                      />
                      {linkView(l).short}
                    </span>
                    <button
                      type="button"
                      className={s.btn}
                      aria-label={t('profile.removeLink')}
                      onClick={() => setLinks(links.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {links.length < MAX_LINKS && (
                  <div className={s.inputRow}>
                    <input
                      value={newLink}
                      onChange={(e) => setNewLink(e.target.value)}
                      type="url"
                      autoComplete="off"
                      aria-label={t('profile.linkPlaceholder')}
                      placeholder={t('profile.linkPlaceholder')}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        addLink();
                      }}
                    />
                    <button
                      type="button"
                      className={s.btn}
                      disabled={!newLink.trim()}
                      onClick={addLink}
                    >
                      {t('profile.addLink')}
                    </button>
                  </div>
                )}
                <p className={`${s.hint} ${s.small}`}>
                  {t('profile.linksHint')}
                </p>
                {linksError && (
                  <p className={s.error} role="alert">
                    {linksError}
                  </p>
                )}
                <div className={s.buttons}>
                  <button
                    type="submit"
                    className={`${s.btn} ${s.primary}`}
                    disabled={busy}
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    className={s.btn}
                    disabled={busy}
                    onClick={() => setEditingLinks(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {shownLinks.length ? (
                  <div className={s.chips}>
                    {shownLinks.map((l) => (
                      <a
                        key={l}
                        href={safeUrl(l)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${s.btn} ${s.linkBtn}`}
                      >
                        <PlatformIcon
                          platform={linkView(l).platform}
                          size={22}
                          round
                        />
                        &nbsp;{linkView(l).short}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className={s.hint}>{t('profile.linksEmpty')}</p>
                )}
                {own && (
                  <button
                    type="button"
                    className={s.linkButton}
                    onClick={() => {
                      setLinks([...profile.links]);
                      setNewLink('');
                      setLinksError('');
                      setEditingLinks(true);
                    }}
                  >
                    {shownLinks.length
                      ? t('profile.linksChange')
                      : t('profile.linksAdd')}
                  </button>
                )}
              </>
            )}
          </section>

          {profile.portfolio.length > 0 && (
            <section className={s.card}>
              <h2>{t('profile.portfolio')}</h2>
              {/* заказчику ссылки не приходят (ведут на аккаунт креатора) — только названия работ */}
              <ul>
                {profile.portfolio.map((p) => (
                  <li key={p.submissionId}>
                    {safeUrl(p.videoUrl) ? (
                      <a
                        href={safeUrl(p.videoUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {p.orderTitle ?? t('profile.otherOrder')}
                      </a>
                    ) : (
                      (p.orderTitle ?? t('profile.otherOrder'))
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={s.card}>
            <h2>{t('profile.reviews')}</h2>
            {!profile.reviews.length && (
              <p className={s.hint}>{t('profile.noReviews')}</p>
            )}
            {profile.reviews.map((r) => (
              <article key={r.submissionId} className={s.fieldset}>
                <span className={s.cardHead}>
                  <span aria-label={t('profile.stars', { rating: r.rating })}>
                    {stars(r.rating)}
                  </span>
                  {r.decidedAt && (
                    <small className={s.muted}>{formatDate(r.decidedAt)}</small>
                  )}
                </span>
                {r.review && <p className={s.quote}>{r.review}</p>}
                <span className={`${s.hint} ${s.small}`}>
                  {r.orderTitle ?? t('profile.otherOrder')}
                </span>
                {own && (
                  <Complaint
                    target="REVIEW"
                    targetId={r.submissionId}
                    label={t('profile.reportReview')}
                  />
                )}
              </article>
            ))}
          </section>

          {!own && (
            <Complaint
              target="PROFILE"
              targetId={profile.id}
              label={t('profile.reportProfile')}
            />
          )}
        </div>

        {own && (
          <aside className={s.page}>
            {balance && (
              <Link to="/balance" className={s.linkRow}>
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
                <span>{t('submissions.withdraw')} ›</span>
              </Link>
            )}

            <section className={s.card}>
              <h2>{t('profile.walletTitle')}</h2>
              {editingWallet ? (
                <form className={s.fieldset} onSubmit={saveWallet}>
                  <label className={s.field}>
                    {t('profile.walletLabel')}
                    <input
                      value={wallet}
                      onChange={(e) => setWallet(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={64}
                      placeholder="T…"
                    />
                  </label>
                  <p className={`${s.hint} ${s.small}`}>
                    {t('profile.walletHint')}
                  </p>
                  {walletError && (
                    <p className={s.error} role="alert">
                      {walletError}
                    </p>
                  )}
                  <div className={s.buttons}>
                    <button
                      type="submit"
                      className={`${s.btn} ${s.primary}`}
                      disabled={busy}
                    >
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      className={s.btn}
                      disabled={busy}
                      onClick={() => setEditingWallet(false)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {profile.wallet ? (
                    <p className={s.wallet}>{profile.wallet}</p>
                  ) : (
                    // без кошелька вывести нельзя — заметно, а не серой строкой
                    <p className={s.alert}>{t('profile.walletEmpty')}</p>
                  )}
                  <button
                    type="button"
                    className={
                      profile.wallet ? s.linkButton : `${s.btn} ${s.primary}`
                    }
                    onClick={() => {
                      setWallet(profile.wallet ?? '');
                      setWalletError('');
                      setEditingWallet(true);
                    }}
                  >
                    {profile.wallet
                      ? t('profile.walletChange')
                      : t('profile.walletAddCta')}
                  </button>
                </>
              )}
            </section>

            {accounts.length > 0 && (
              <section className={s.card}>
                <h2>{t('profile.accountsTitle')}</h2>
                {connected.map(({ a, acc }) => (
                  <div key={acc.id} className={s.cardHead}>
                    <span className={s.check}>
                      <PlatformIcon platform={a.platform} size={28} />
                      {a.name}
                      {acc.label ? ` · ${acc.label}` : ''}
                    </span>
                    <button
                      type="button"
                      className={s.linkButton}
                      onClick={() => disconnect(a, acc)}
                    >
                      {t('profile.disconnect')}
                    </button>
                  </div>
                ))}
                <p className={`${s.hint} ${s.small}`}>
                  {t('web.connectInMiniApp')}
                </p>
                {accountsError && (
                  <p className={s.error} role="alert">
                    {accountsError}
                  </p>
                )}
              </section>
            )}

            <section className={s.card}>
              <h2>{t('profile.notificationsTitle')}</h2>
              <label className={s.check}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={profile.notifyNewOrders ?? true}
                  onChange={(e) => void toggleNewOrders(e.target.checked)}
                />
                <span>
                  {t('profile.newOrders')}
                  <small className={`${s.hint} ${s.block}`}>
                    {t('profile.newOrdersHint')}
                  </small>
                </span>
              </label>
              {notifyError && (
                <p className={s.error} role="alert">
                  {notifyError}
                </p>
              )}
            </section>

            <LanguagePicker />
          </aside>
        )}
      </div>
    </div>
  );
}
