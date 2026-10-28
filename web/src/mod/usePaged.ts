import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Список с «Показать ещё» (заказы, люди): страница за страницей, заново — при смене фильтра.
 * Ответ на устаревший запрос (фильтр успели сменить) не подмешиваем.
 */
export function usePaged<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
  /** Пауза перед первой страницей после смены фильтра (поиск по мере ввода), мс. */
  delay = 0,
) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** Последняя загруженная страница; -1 — ещё ни одной. */
  const page = useRef(-1);
  const lastRequest = useRef(0);

  const loadMore = useCallback(
    async (reset = false) => {
      const requestId = ++lastRequest.current;
      if (reset) {
        page.current = -1;
        setItems([]);
        setError(false);
      }
      setLoading(true);
      try {
        const res = await fetchPage(page.current + 1);
        if (requestId !== lastRequest.current) return;
        setItems((list) => [...list, ...res.items]);
        setTotal(res.total);
        page.current += 1;
      } catch {
        if (requestId === lastRequest.current) setError(true);
      } finally {
        if (requestId === lastRequest.current) setLoading(false);
      }
    },
    [fetchPage],
  );

  // fetchPage меняется вместе с фильтром — грузим заново
  useEffect(() => {
    const timer = setTimeout(() => void loadMore(true), delay);
    return () => clearTimeout(timer);
  }, [loadMore, delay]);

  return { items, total, loading, error, loadMore: () => void loadMore() };
}
