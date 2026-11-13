import { type FormEvent, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { renderSVG } from 'uqr';
import { codeLogin, errorText, fetchWebConfig, startCodeLogin } from './api';
import s from './Login.module.css';

const TG_ICON = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 4L3 11l6 2 2 6 3-4 5 4z" />
    <path d="M9 13l8-6" />
  </svg>
);

/** Ждём код: токен входа переживает перезагрузку вкладки (телефон выгружает её, пока человек в Telegram). */
const PENDING_KEY = 'fixum:loginPending';
/** Как WebLoginService (TTL_MS): дольше токен не живёт. */
const PENDING_TTL_MS = 10 * 60_000;
type Pending = { token: string; link: string; at: number };

function readPending(): Pending | undefined {
  try {
    const p = JSON.parse(
      sessionStorage.getItem(PENDING_KEY) ?? 'null',
    ) as Pending | null;
    return p && Date.now() - p.at < PENDING_TTL_MS ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Куда человек шёл до входа через Telegram: после OpenID Connect бэкенд всегда возвращает на «/»
 * (WebAuthController, siteUrl), а с лендинга ведут, например, на заявку /profile/advertiser.
 * Вход кодом из бота страницу не покидает — ему это не нужно.
 */
const RETURN_KEY = 'fixum:returnTo';

function rememberReturn() {
  const path = location.pathname;
  if (path !== '/' && path !== '/login')
    sessionStorage.setItem(RETURN_KEY, path + location.search);
}

/** Адрес, с которого ушли входить (один раз); только свой путь, не чужой сайт. */
export function takeReturnPath(): string | null {
  const path = sessionStorage.getItem(RETURN_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  return path?.startsWith('/') && !path.startsWith('//') ? path : null;
}

/** Telegram вернул на сайт с ошибкой входа (WebAuthController, oidc/callback) — убираем её из адреса. */
function takeLoginError(): boolean {
  const params = new URLSearchParams(location.search);
  if (!params.has('login_error')) return false;
  params.delete('login_error');
  const query = params.toString();
  history.replaceState(
    null,
    '',
    location.pathname + (query ? `?${query}` : '') + location.hash,
  );
  return true;
}

/**
 * Вход. Основной — через Telegram (OpenID Connect): ссылка уводит на oauth.telegram.org, бэкенд
 * ставит сессию и возвращает сюда. Запасной (и единственный, если OIDC не настроен) — кодом из бота:
 * кнопка открывает бота по одноразовой ссылке, бот присылает код, его вводят здесь (WebLoginService).
 */
export function Login({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();
  // null — настройки ещё грузятся
  const [oidc, setOidc] = useState<boolean | null>(null);
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() =>
    takeLoginError() ? t('web.loginFailed') : '',
  );
  // ссылка на бота получена — ждём код из Telegram
  const [pending, setPending] = useState(readPending);
  const [code, setCode] = useState('');

  useEffect(() => {
    fetchWebConfig().then(
      (c) => {
        setBotUrl(c.botUrl);
        setOidc(c.oidc);
      },
      () => setOidc(false), // без настроек — вход кодом
    );
  }, []);

  async function startCode() {
    setError('');
    // окно — прямо из нажатия (иначе браузер его заблокирует), адрес — когда придёт ссылка
    const tab = window.open('', '_blank');
    try {
      const res = { ...(await startCodeLogin()), at: Date.now() };
      setPending(res);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(res));
      setCode('');
      if (tab) tab.location.href = res.link;
    } catch (err) {
      tab?.close();
      setError(errorText(err, t('web.loginFailed')));
    }
  }

  async function sendCode(value: string) {
    if (!pending || busy) return;
    setBusy(true);
    setError('');
    try {
      await codeLogin(pending.token, value);
      sessionStorage.removeItem(PENDING_KEY);
      onLogin();
    } catch (err) {
      setError(errorText(err, t('web.loginFailed')));
      setBusy(false);
    }
  }

  return (
    <div className={s.page}>
      <section className={s.hero}>
        <Logo />
        <div className={s.pitch}>
          <h1>{t('web.title')}</h1>
          <p className={s.wideOnly}>{t('web.lead')}</p>
          <Points className={s.wideOnly} />
        </div>
      </section>
      <section className={s.side}>
        <div className={s.card}>
          <h2>{t('web.loginTitle')}</h2>
          {pending ? (
            <form
              className={s.codeForm}
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void sendCode(code);
              }}
            >
              <label htmlFor="login-code">{t('web.loginCodeLabel')}</label>
              <input
                id="login-code"
                value={code}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  setCode(value);
                  // 4 цифры — отправляем сами; кнопка «Войти» — на случай ошибки
                  if (value.length === 4) void sendCode(value);
                }}
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="••••"
                autoFocus
              />
              {error && <LoginError text={error} />}
              <button
                type="submit"
                className={s.telegram}
                disabled={busy || code.length !== 4}
              >
                {busy ? t('common.loading') : t('web.loginSubmit')}
              </button>
              <a
                href={pending.link}
                target="_blank"
                rel="noopener noreferrer"
                className={s.secondary}
              >
                {t('web.loginOpenTelegram')}
              </a>
              {/* Telegram только на телефоне: та же ссылка камерой — бот пришлёт код туда */}
              <div className={`${s.qr} ${s.wideOnly}`}>
                <img
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(pending.link, { border: 1 }))}`}
                  alt={t('web.loginQrAlt')}
                  width={132}
                  height={132}
                />
                <span>{t('web.loginQr')}</span>
              </div>
            </form>
          ) : (
            <>
              {oidc ? (
                <a
                  className={s.telegram}
                  href="/api/web/oidc/start"
                  onClick={rememberReturn}
                >
                  {TG_ICON}
                  {t('web.loginButton')}
                </a>
              ) : (
                <button
                  type="button"
                  className={s.telegram}
                  onClick={startCode}
                  disabled={oidc === null}
                >
                  {TG_ICON}
                  {t('web.loginButton')}
                </button>
              )}
              {error && <LoginError text={error} />}
              {oidc && (
                <button
                  type="button"
                  className={s.secondary}
                  onClick={startCode}
                >
                  {t('web.loginByCode')}
                </button>
              )}
            </>
          )}
          {/* бот уже открыт — вместо шагов что делать сейчас; шаги — только у входа кодом */}
          {pending ? (
            <p className={s.note}>{t('web.loginWaiting')}</p>
          ) : (
            oidc === false && (
              <ol className={s.steps}>
                <li>{t('web.loginStep1')}</li>
                <li>{t('web.loginStep2')}</li>
                <li>{t('web.loginStep3')}</li>
              </ol>
            )
          )}
          <span className={s.note}>
            <Trans
              i18nKey="web.loginText"
              components={{
                app: botUrl ? (
                  <a href={botUrl} target="_blank" rel="noopener noreferrer" />
                ) : (
                  <span />
                ),
              }}
            />
          </span>
        </div>
        {/* на телефоне описание — под входом: кто пришёл войти, видит кнопку сразу */}
        <p className={`${s.narrowOnly} ${s.lead}`}>{t('web.lead')}</p>
        <Points className={s.narrowOnly} />
        {/* правила и поддержка — до входа: сервис работает с деньгами */}
        <nav className={s.legal} aria-label={t('web.legalAria')}>
          {/* страницы сайта (собираются вместе с лендингом), а не мини-аппа */}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">
            {t('catalog.terms')}
          </a>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            {t('catalog.privacy')}
          </a>
          {botUrl && (
            <a href={botUrl} target="_blank" rel="noopener noreferrer">
              {t('common.support')}
            </a>
          )}
        </nav>
      </section>
    </div>
  );
}

function LoginError({ text }: { text: string }) {
  return (
    <p id="login-error" className={s.error} role="alert">
      {text}
    </p>
  );
}

/** Чем Fixum отличается — по сторонам сделки (web.points). */
function Points({ className }: { className: string }) {
  const { t } = useTranslation();
  const groups = t('web.points', { returnObjects: true }) as unknown as {
    title: string;
    items: { b: string; text: string }[];
  }[];
  return (
    <div className={`${className} ${s.points}`}>
      {groups.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <ul>
            {g.items.map((i) => (
              <li key={i.b}>
                <strong>{i.b}</strong> {i.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Logo() {
  return (
    <div className={s.logo}>
      <span className={s.mark}>F</span>
      <span>Fixum</span>
    </div>
  );
}
