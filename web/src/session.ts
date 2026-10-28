import type { Me } from '@fixum/shared';
import { createContext, useContext } from 'react';

/** Кто вошёл, обновить это (сменили кабинет или язык) и выход — для всех экранов после входа (App.tsx). */
export const Session = createContext<{
  me: Me;
  setMe: (me: Me) => void;
  logout: () => void;
} | null>(null);

export function useSession() {
  return useContext(Session)!;
}
