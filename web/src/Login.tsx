import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchWebConfig, login, type TelegramAuth } from './api';
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

/** Вход: Telegram подтверждает его в своём окне, бэкенд проверяет подпись и ставит cookie сессии. */
export function Login({ onLogin }: { onLogin: () => void }) {
  const { t, i18n } = useTranslation();
  const [botId, setBotId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    Promise.all([fetchWebConfig(), loadTelegramLogin()]).then(
      ([config]) => setBotId(config.botId),
      () => setFailed(true),
    );
  }, []);

  function start() {
    if (botId === null || !window.Telegram) return;
    setFailed(false);
    window.Telegram.Login.auth(
      { bot_id: botId, lang: i18n.language },
      (data) => {
        if (!data) return; // окно закрыли
        setBusy(true);
        login(data).then(onLogin, () => {
          setBusy(false);
          setFailed(true);
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
          <p>{t('web.lead')}</p>
        </div>
      </section>
      <section className={s.side}>
        <div className={s.card}>
          <h2>{t('web.loginTitle')}</h2>
          <p>{t('web.loginText')}</p>
          <button
            type="button"
            className={s.telegram}
            onClick={start}
            disabled={botId === null || busy}
          >
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
            {busy ? t('common.loading') : t('web.loginButton')}
          </button>
          {failed && (
            <p className={s.error} role="alert">
              {t('web.loginFailed')}
            </p>
          )}
          <span className={s.note}>{t('web.loginNote')}</span>
        </div>
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
