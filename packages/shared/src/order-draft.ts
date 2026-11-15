/**
 * Черновик формы заказа в sessionStorage: случайно закрыли вкладку, свернули мини-апп или ушли «Назад» —
 * введённое не пропадает. Живёт до закрытия вкладки; после отправки заказа стирается.
 * Ключ — какая форма: новый заказ, по образцу или правка конкретного заказа.
 */
export function orderDraftKey(editId?: number, fromId?: number): string {
  return `fixum:order-draft:${editId ? `edit-${editId}` : fromId ? `from-${fromId}` : 'new'}`;
}

export function loadOrderDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Форма совпала с исходной — черновик не нужен, стираем. */
export function saveOrderDraft<T>(key: string, form: T, baseline: T): void {
  try {
    const json = JSON.stringify(form);
    if (json === JSON.stringify(baseline)) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, json);
  } catch {
    // хранилище недоступно (приватный режим) — просто без черновика
  }
}

export function clearOrderDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // нет хранилища — нечего стирать
  }
}
