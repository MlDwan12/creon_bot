import { ref } from 'vue';

const KEY = 'onboardingSeen';

// localStorage может быть недоступен (приватный режим, очищенные данные) — тогда онбординг
// просто покажется ещё раз, это не страшно.
function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Показан ли онбординг сейчас. Первый запуск — да; потом открывается ссылкой «Как это работает». */
export const onboardingOpen = ref(!seen());

export function closeOnboarding() {
  onboardingOpen.value = false;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // см. выше
  }
}
