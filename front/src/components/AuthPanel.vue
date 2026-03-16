<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();

const mode = ref<'login' | 'register'>('register');
const email = ref('');
const displayName = ref('');
const password = ref('');

async function submit() {
  if (mode.value === 'register') {
    await authStore.register({
      email: email.value,
      displayName: displayName.value,
      password: password.value,
    });
    return;
  }

  await authStore.login({
    email: email.value,
    password: password.value,
  });
}
</script>

<template>
  <section class="panel">
    <div class="panel__header">
      <div>
        <p class="eyebrow">Аккаунт</p>
        <h2>Зарегистрированные игроки</h2>
      </div>
      <div class="segmented">
        <button
          :class="{ active: mode === 'register' }"
          type="button"
          @click="mode = 'register'"
        >
          Регистрация
        </button>
        <button
          :class="{ active: mode === 'login' }"
          type="button"
          @click="mode = 'login'"
        >
          Вход
        </button>
      </div>
    </div>

    <div v-if="authStore.user" class="account-badge">
      <strong>{{ authStore.user.displayName }}</strong>
      <span>{{ authStore.user.email }}</span>
      <button class="ghost-button" type="button" @click="authStore.logout()">
        Выйти
      </button>
    </div>

    <form v-else class="stack" @submit.prevent="submit">
      <label v-if="mode === 'register'" class="field">
        <span>Имя</span>
        <input v-model.trim="displayName" type="text" placeholder="Arthas" required />
      </label>

      <label class="field">
        <span>Email</span>
        <input v-model.trim="email" type="email" placeholder="gm@example.com" required />
      </label>

      <label class="field">
        <span>Пароль</span>
        <input
          v-model="password"
          type="password"
          minlength="6"
          placeholder="Минимум 6 символов"
          required
        />
      </label>

      <button class="primary-button" type="submit" :disabled="authStore.loading">
        {{ mode === 'register' ? 'Создать аккаунт' : 'Войти' }}
      </button>
      <p v-if="authStore.error" class="error-text">{{ authStore.error }}</p>
    </form>
  </section>
</template>
