import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  codeLogin,
  errorText,
  fetchWebConfig,
  login,
  startCodeLogin,
  type TelegramAuth,
} from './api';
import s from './Login.module.css';

declare global {
  interface Window {
    /** Скрипт входа Telegram (telegram-widget.js): окно подтверждения входа у Telegram. */
    Telegram?: {
      Login: {
        auth(
          options: { bot_id: number; lang?: string },
          callback: (data: TelegramAuth | false) => void,
        ): void;
      };
    };
  }
}

// Окно открывается прямо из нажатия (иначе его заблокирует браузер), поэтому скрипт грузим заранее.
function loadTelegramLogin(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Telegram?.Login) return resolve();
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('telegram-widget.js'));
    document.head.append(script);
  });
}

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

/**
 * Вход. Основной — кодом из бота: кнопка открывает бота по одноразовой ссылке, бот присылает код,
 * его вводят здесь (WebLoginService на бэкенде) — без окна Telegram, где он просит номер телефона.
 * Запасной — то самое окно (Telegram Login Widget): «Войти по номеру телефона».
 */
export function Login({ onLogin }: { onLogin: () => void }) {
  const { t, i18n } = useTranslation();
  const [botId, setBotId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // ссылка на бота получена — ждём код из Telegram
  const [pending, setPending] = useState<{ token: string; link: string }>();
  const [code, setCode] = useState('');

  useEffect(() => {
    Promise.all([fetchWebConfig(), loadTelegramLogin()]).then(
      ([config]) => setBotId(config.botId),
      () => {}, // без виджета останется вход кодом
    );
  }, []);

  async function startCode() {
    setError('');
    // окно — прямо из нажатия (иначе браузер его заблокирует), адрес — когда придёт ссылка
    const tab = window.open('', '_blank');
    try {
      const res = await startCodeLogin();
      setPending(res);
      setCode('');
      if (tab) tab.location.href = res.link;
    } catch (err) {
      tab?.close();
      setError(errorText(err, t('web.loginFailed')));
    }
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await codeLogin(pending.token, code);
      onLogin();
    } catch (err) {
      setError(errorText(err, t('web.loginFailed')));
      setBusy(false);
    }
  }

  function byPhone() {
    if (botId === null || !window.Telegram) return;
    setError('');
    window.Telegram.Login.auth(
      { bot_id: botId, lang: i18n.language },
      (data) => {
        if (!data) return; // окно закрыли
        setBusy(true);
        login(data).then(onLogin, () => {
          setBusy(false);
          setError(t('web.loginFailed'));
        });
      },
    );
  }

  return (
    <div className={s.page}>
      <section className={s.hero}>
        <Logo />
        <div className={s.pitch}>
          <h1>{t('web.title')}</h1>
          <p className={s.wideOnly}>{t('web.lead')}</p>
        </div>
      </section>
      <section className={s.side}>
        <div className={s.card}>
          <h2>{t('web.loginTitle')}</h2>
          {pending ? (
            <form className={s.codeForm} onSubmit={sendCode}>
              <label htmlFor="login-code">{t('web.loginCodeLabel')}</label>
              <input
                id="login-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="••••"
                autoFocus
              />
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
            </form>
          ) : (
            <button type="button" className={s.telegram} onClick={startCode}>
              {TG_ICON}
              {t('web.loginButton')}
            </button>
          )}
          <ol className={s.steps}>
            <li>{t('web.loginStep1')}</li>
            <li>{t('web.loginStep2')}</li>
            <li>{t('web.loginStep3')}</li>
          </ol>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <span className={s.note}>
            {t('web.loginText')}{' '}
            {botId !== null && (
              <button type="button" className={s.byPhone} onClick={byPhone}>
                {t('web.loginByPhone')}
              </button>
            )}
          </span>
        </div>
        {/* на телефоне описание — под входом: кто пришёл войти, видит кнопку сразу */}
        <p className={`${s.narrowOnly} ${s.lead}`}>{t('web.lead')}</p>
      </section>
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
