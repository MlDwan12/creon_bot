<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { role, ROLE_HOME, type Role } from '../role';

const ROLES: Role[] = ['creator', 'advertiser'];
</script>

<template>
  <!-- Ссылки, а не кнопки: роль переключает сам переход (router.afterEach → roleOfPath). -->
  <nav class="role-switch" :aria-label="$t('roles.aria')">
    <RouterLink
      v-for="r in ROLES"
      :key="r"
      :to="ROLE_HOME[r]"
      :aria-current="role === r ? 'page' : undefined"
    >
      {{ $t(`roles.${r}`) }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.role-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 12px 16px 0;
  padding: 3px;
  border-radius: 14px;
  background: var(--fill);
}
.role-switch a {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  border-radius: 11px;
  color: var(--hint);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}
.role-switch a[aria-current] {
  background: var(--text);
  color: var(--bg);
}
</style>
