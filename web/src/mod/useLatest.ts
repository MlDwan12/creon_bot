import { useEffect, useRef, useState } from 'react';

/**
 * Данные за выбранный период: быстро переключили период — применяем только ответ на последний запрос.
 */
export function useLatest<T, K>(fetch: (key: K) => Promise<T>, key: K) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const lastRequest = useRef(0);
  useEffect(() => {
    const requestId = ++lastRequest.current;
    setError(false);
    fetch(key).then(
      (d) => requestId === lastRequest.current && setData(d),
      () => requestId === lastRequest.current && setError(true),
    );
  }, [fetch, key]);
  return { data, error };
}
