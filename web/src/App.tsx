import { ApiError, type Me } from '@fixum/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RouterProvider } from 'react-router/dom';
import { codeLogin, fetchMe, logout, RELOGIN_EVENT } from './api';
import { Login, takeReturnPath } from './Login';
import { router } from './router';
import { Session } from './session';
import s from './App.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'error' }
  | {
      kind: 'banned';
      final: boolean;
      reason: string | null;
      supportUrl: string | null;
    }
  | { kind: 'in'; me: Me };

/**
 * Метка «вошёл» для nginx: на «/» вошедшим — кабинеты, гостям — лендинг (deploy/prod/nginx/fixum-web.conf).
 * Её ставит и бэкенд при входе (WebAuthController, fx_in); здесь — чтобы она не расходилась с сессией:
 * старые входы без метки получают её, истёкшие — теряют. Прав метка не даёт.
 */
function markSignedIn(on: boolean) {
  document.cookie = on
    ? `fx_in=1; path=/; max-age=${30 * 24 * 60 * 60}; secure; samesite=lax`
    : 'fx_in=; path=/; max-age=0; secure; samesite=lax';
}

export function App() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });
  /** API попросил свежий вход (кошелёк, вывод) — окно с кнопкой «Войти заново». */
  const [relogin, setRelogin] = useState(false);
  useEffect(() => {
    const show = () => setRelogin(true);
    window.addEventListener(RELOGIN_EVENT, show);
    return () => window.removeEventListener(RELOGIN_EVENT, show);
  }, []);
  /** Выход и сразу экран входа: подтверждение Telegram даст свежий вход. */
  const signOut = () =>
    void logout().then(
      () => {
        markSignedIn(false);
        setRelogin(false);
        setState({ kind: 'guest' });
      },
      () => setState({ kind: 'error' }),
    );

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    // кнопка «Войти на сайт» из бота: ?login=<токен>.<код> — входим без ввода кода
    const link = /^([\w-]+)\.(\d{4})$/.exec(
      new URLSearchParams(location.search).get('login') ?? '',
    );
    if (link) history.replaceState(null, '', location.pathname + location.hash);
    const signIn = link
      ? codeLogin(link[1], link[2]).catch(() => {}) // устарела — обычный экран входа
      : Promise.resolve();
    signIn.then(fetchMe).then(
      (me) => {
        markSignedIn(true);
        setState({ kind: 'in', me });
        // вернулись из Telegram на «/» — открываем страницу, с которой уходили входить
        const back = takeReturnPath();
        if (back) void router.navigate(back, { replace: true });
      },
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          markSignedIn(false);
          return setState({ kind: 'guest' });
        }
        if (err instanceof ApiError && err.data?.banned)
          return setState({
            kind: 'banned',
            final: err.data.final === true,
            reason: (err.data.reason as string | null) ?? null,
            supportUrl: (err.data.supportUrl as string | null) ?? null,
          });
        setState({ kind: 'error' });
      },
    );
  }, []);

  useEffect(load, [load]);

  switch (state.kind) {
    case 'loading':
      return <p className={s.center}>{t('common.loading')}</p>;
    case 'guest':
      return <Login onLogin={load} />;
    case 'in':
      return (
        <Session
          value={{
            me: state.me,
            setMe: (me) => setState({ kind: 'in', me }),
            logout: signOut,
          }}
        >
          <RouterProvider router={router} />
          {relogin && (
            <div className={s.overlay} role="alertdialog" aria-modal="true">
              <div className={s.dialog}>
                <p>{t('errors.relogin')}</p>
                <div className={s.dialogButtons}>
                  <button type="button" className={s.retry} onClick={signOut}>
                    {t('web.relogin')}
                  </button>
                  <button
                    type="button"
                    className={s.cancel}
                    onClick={() => setRelogin(false)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Session>
      );
    case 'banned':
      return (
        <div className={s.center}>
          <h1>{t(state.final ? 'banned.closed' : 'web.banned')}</h1>
          {state.reason && <p>{state.reason}</p>}
          {state.supportUrl && (
            <a href={state.supportUrl} target="_blank" rel="noreferrer">
              {t('web.writeSupport')}
            </a>
          )}
        </div>
      );
    case 'error':
      return (
        <div className={s.center}>
          <p>{t('common.loadFailed')}</p>
          <button type="button" className={s.retry} onClick={load}>
            {t('common.retry')}
          </button>
        </div>
      );
  }
}
