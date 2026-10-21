import { ref } from 'vue';
import { fetchMe, updateCabinet } from './api';

/**
 * Кабинет, в котором сейчас пользователь: креатор или заказчик. Аккаунт один и может быть обоими —
 * роль только выбирает вкладки и стартовый экран, прав не даёт. Модератор — отдельное окно /mod.
 * Хранится на сервере (User.cabinet) — один на всех устройствах; localStorage — только чтобы
 * сразу показать нужные вкладки, пока /api/me не ответил.
 */
export type Role = 'creator' | 'advertiser';

const KEY = 'role';

/** Главный экран кабинета: сюда ведёт переключатель роли. */
export const ROLE_HOME: Record<Role, string> = {
  creator: '/',
  advertiser: '/my-orders',
};

/**
 * Чей это экран. Ссылки из уведомлений бота ведут прямо на экран — по нему и переключаем кабинет.
 * Общие (поддержка, жалоба, политика) — ничьи: роль не меняют.
 */
export function roleOfPath(path: string): Role | undefined {
  if (
    path === '/' ||
    /^\/(orders|submissions|balance|learn|profile)(\/|$)/.test(path)
  )
    return 'creator';
  if (/^\/(my-orders|creators|help|account)(\/|$)/.test(path))
    return 'advertiser';
  return undefined;
}

function readLocal(): Role | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'creator' || v === 'advertiser' ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(r: Role) {
  try {
    localStorage.setItem(KEY, r);
  } catch {
    // без хранилища вкладки просто подождут ответа сервера
  }
}

/** undefined — ещё не выбрана: показываем выбор роли. */
export const role = ref<Role | undefined>(readLocal());

/** Кабинет с сервера главнее копии на устройстве (выбран на другом устройстве). */
export const roleReady: Promise<void> = fetchMe()
  .then(({ cabinet }) => {
    // выбор не дошёл до сервера (сбой сети) — досохраняем
    if (!cabinet) {
      if (role.value) updateCabinet(role.value).catch(() => {});
      return;
    }
    role.value = cabinet;
    writeLocal(cabinet);
  })
  .catch(() => {});

/** Роль уже известна (или точно не выбрана): пока сервер отвечает, выбор роли не показываем. */
export const roleLoaded = ref(false);
void roleReady.then(() => (roleLoaded.value = true));

export function setRole(r: Role) {
  if (role.value === r) return;
  role.value = r;
  writeLocal(r);
  // не сохранилось — не страшно: вкладки уже переключены, на сервер уйдёт при следующей смене
  updateCabinet(r).catch(() => {});
}
