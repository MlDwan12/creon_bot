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
  // окно Telegram открыто — ждём подтверждения; закрыли окно — снова обычная кнопка
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    Promise.all([fetchWebConfig(), loadTelegramLogin()]).then(
      ([config]) => setBotId(config.botId),
      () => setFailed(true),
    );
  }, []);

  function start() {
    if (botId === null || !window.Telegram) return;
    setFailed(false);
    setWaiting(true);
    window.Telegram.Login.auth(
      { bot_id: botId, lang: i18n.language },
      (data) => {
        setWaiting(false);
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
          <p className={s.wideOnly}>{t('web.lead')}</p>
        </div>
      </section>
      <section className={s.side}>
        <div className={s.card}>
          <h2>{t('web.loginTitle')}</h2>
          <button
            type="button"
            className={`${s.telegram} ${waiting ? s.waiting : ''}`}
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
            {busy
              ? t('common.loading')
              : waiting
                ? t('web.loginWaiting')
                : t('web.loginButton')}
          </button>
          {/* что будет в окне Telegram: номер он спрашивает, только если браузер ещё не входил */}
          <ol className={s.steps}>
            <li>{t('web.loginStep1')}</li>
            <li>{t('web.loginStep2')}</li>
            <li>{t('web.loginStep3')}</li>
          </ol>
          {waiting && <p className={s.popupHint}>{t('web.loginPopupHint')}</p>}
          {failed && (
            <p className={s.error} role="alert">
              {t('web.loginFailed')}
            </p>
          )}
          <span className={s.note}>
            {t('web.loginText')} {t('web.loginNote')}
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
