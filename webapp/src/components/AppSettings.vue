<script setup lang="ts">
import { ref } from 'vue';
import { fetchMe, updateLanguage } from '../api';
import { i18next, LANG_NAMES, LANGS, setLang, type Lang } from '../i18n';
import { setThemePref, themePref, type ThemePref } from '../telegram';

/** Оформление и язык — одинаковые в профиле креатора и заказчика. */

// Тема — только для этого устройства (localStorage), как и сам выбор в Telegram.
const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'auto', label: 'settings.themeAuto' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeDark' },
];
const theme = ref<ThemePref>(themePref());
function pickTheme(pref: ThemePref) {
  theme.value = pref;
  setThemePref(pref);
}

// Язык — на сервере (User.language): на нём же пишет бот. auto — по языку Telegram.
type LangPref = Lang | 'auto';
const langPref = ref<LangPref>();
const langError = ref('');
void fetchMe()
  .then((me) => (langPref.value = me.languageChosen ? me.language : 'auto'))
  .catch(() => {});
async function pickLang(pref: LangPref) {
  langError.value = '';
  try {
    await updateLanguage(pref === 'auto' ? null : pref);
    const me = await fetchMe();
    langPref.value = pref;
    setLang(me.language);
  } catch {
    langError.value = i18next.t('settings.languageError');
  }
}
</script>

<template>
  <section class="block">
    <h2 id="theme-label" class="section-title">{{ $t('settings.themeTitle') }}</h2>
    <div class="segmented" role="radiogroup" aria-labelledby="theme-label">
      <button
        v-for="t in THEMES"
        :key="t.value"
        type="button"
        role="radio"
        :aria-checked="theme === t.value"
        @click="pickTheme(t.value)"
      >
        {{ $t(t.label) }}
      </button>
    </div>
  </section>

  <section class="block">
    <h2 id="lang-label" class="section-title">{{ $t('settings.languageTitle') }}</h2>
    <div class="segmented" role="radiogroup" aria-labelledby="lang-label">
      <button type="button" role="radio" :aria-checked="langPref === 'auto'" @click="pickLang('auto')">
        {{ $t('settings.languageAuto') }}
      </button>
      <!-- названия языков — на самих языках: найдёт и тот, кто не понимает текущий -->
      <button
        v-for="l in LANGS"
        :key="l"
        type="button"
        role="radio"
        :lang="l"
        :aria-checked="langPref === l"
        @click="pickLang(l)"
      >
        {{ LANG_NAMES[l] }}
      </button>
    </div>
    <p v-if="langError" class="error" role="alert">{{ langError }}</p>
  </section>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.block .section-title {
  padding: 0;
}
.segmented {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 16px;
  background: var(--fill);
}
.segmented button {
  min-height: 44px;
  padding: 0 4px;
  border: none;
  border-radius: 12px;
  background: none;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
/* выбранное видно и в тёмной теме: плашка с фиолетовой обводкой */
.segmented button[aria-checked='true'] {
  background: var(--surface);
  box-shadow: inset 0 0 0 1.5px var(--accent);
  font-weight: 800;
}
.error {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}
</style>
