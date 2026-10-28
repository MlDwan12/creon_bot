import { ApiError, type Me } from '@fixum/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchMe, logout } from './api';
import { Login } from './Login';
import { Shell } from './Shell';
import s from './App.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'error' }
  | { kind: 'banned'; reason: string | null; supportUrl: string | null }
  | { kind: 'in'; me: Me };

export function App() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    fetchMe().then(
      (me) => setState({ kind: 'in', me }),
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 401)
          return setState({ kind: 'guest' });
        if (err instanceof ApiError && err.data?.banned)
          return setState({
            kind: 'banned',
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
        <Shell
          me={state.me}
          onLogout={() =>
            void logout().then(
              () => setState({ kind: 'guest' }),
              () => setState({ kind: 'error' }),
            )
          }
        />
      );
    case 'banned':
      return (
        <div className={s.center}>
          <h1>{t('web.banned')}</h1>
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
