import { useSyncExternalStore } from 'react';

/** Общее состояние вне компонентов (роль, блокировка): меняют модули, перерисовываются подписчики. */
export type Store<T> = {
  get(): T;
  set(value: T): void;
  subscribe(cb: () => void): () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      subs.forEach((cb) => cb());
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
