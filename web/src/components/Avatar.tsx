import { useEffect, useState } from 'react';
import { fetchCreatorPhoto } from '../api';
import s from '../ui.module.css';

// Креатор для заказчика — «Креатор А. · L6LW» (publicName на сервере): буква и код, иначе у всех «КР»
const ALIAS = /(?:(\p{L})\. )?· (\w)\w{3}$/u;
function initials(name: string) {
  const alias = name.match(ALIAS);
  if (alias) return `${alias[1] ?? ''}${alias[2]}`;
  return name.replace('@', '').slice(0, 2).toUpperCase();
}

/** Фото из Telegram; пока грузится или его нет — инициалы (как webapp/src/components/UserAvatar.tsx). */
export function Avatar({
  userId,
  name,
  size = 44,
}: {
  userId: number;
  name: string;
  size?: number;
}) {
  const [photo, setPhoto] = useState<{ id: number; url: string | null }>();
  useEffect(() => {
    let alive = true;
    void fetchCreatorPhoto(userId).then(
      (url) => alive && setPhoto({ id: userId, url }),
    );
    return () => {
      alive = false;
    };
  }, [userId]);
  const url = photo?.id === userId ? photo.url : null;
  return (
    <span
      className={s.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}
