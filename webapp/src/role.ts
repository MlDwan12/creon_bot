import { fetchMe, updateCabinet } from './api';
import { createStore } from './store';

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
export const role = createStore<Role | undefined>(readLocal());

/**
 * Модератор: у него отдельное окно /mod, обычные экраны закрыты (App.tsx уводит туда).
 * Это только навигация — права на каждый /api/mod/* проверяет бэкенд (ModeratorGuard).
 */
export const moderator = createStore(false);

/**
 * Кабинет заказчика: open — открыт модератором; closed — закрыт (свои заказы только смотреть);
 * null — нет, вместо кабинета — заявка «Стать заказчиком» в профиле. Это только навигация:
 * создавать и править заказы без открытого кабинета не даёт бэкенд (AdvertiserGuard).
 */
export const advertiserCabinet = createStore<'open' | 'closed' | null>(null);

/** Экран заявки «Стать заказчиком» — сюда ведут экраны заказчика, пока кабинета нет. */
export const APPLY_PATH = '/profile/advertiser';

/** Кабинет с сервера главнее копии на устройстве (выбран на другом устройстве). */
export const roleReady: Promise<void> = fetchMe()
  .then(({ cabinet, isModerator, advertiser }) => {
    moderator.set(isModerator);
    advertiserCabinet.set(advertiser);
    // кабинет заказчика закрыт или ещё не открыт — остаёмся креатором
    if (cabinet === 'advertiser' && !advertiser) {
      setRole('creator');
      return;
    }
    // выбор не дошёл до сервера (сбой сети) — досохраняем
    if (!cabinet) {
      const r = role.get();
      if (r) updateCabinet(r).catch(() => {});
      return;
    }
    role.set(cabinet);
    writeLocal(cabinet);
  })
  .catch(() => {});

/** Роль уже известна (или точно не выбрана): пока сервер отвечает, выбор роли не показываем. */
export const roleLoaded = createStore(false);
void roleReady.then(() => roleLoaded.set(true));

export function setRole(r: Role) {
  if (role.get() === r) return;
  role.set(r);
  writeLocal(r);
  // не сохранилось — не страшно: вкладки уже переключены, на сервер уйдёт при следующей смене
  updateCabinet(r).catch(() => {});
}
