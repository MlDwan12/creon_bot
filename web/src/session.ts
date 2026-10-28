import type { Me } from '@fixum/shared';
import { createContext, useContext } from 'react';

/** Кто вошёл и выход — для всех экранов после входа (App.tsx). */
export const Session = createContext<{ me: Me; logout: () => void } | null>(
  null,
);

export function useSession() {
  return useContext(Session)!;
}
