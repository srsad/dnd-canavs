<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import AuthPanel from '../components/AuthPanel.vue';
import CreateRoomPanel from '../components/CreateRoomPanel.vue';
import { apiRequest } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useRoomStore } from '../stores/room';

const router = useRouter();
const authStore = useAuthStore();
const roomStore = useRoomStore();
const roomLink = ref('');
const importInput = useTemplateRef<HTMLInputElement>('importInput');
const importError = ref<string | null>(null);

async function onImportPick() {
  importError.value = null;
  const input = importInput.value;
  const file = input?.files?.[0];
  if (!file || !authStore.accessToken) {
    return;
  }
  try {
    const text = await file.text();
    const body = JSON.parse(text) as unknown;
    const res = await apiRequest<{ slug: string }>('/rooms/import', {
      method: 'POST',
      token: authStore.accessToken,
      body,
    });
    if (input) {
      input.value = '';
    }
    await router.push(`/room/${res.slug}`);
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Импорт не удался.';
  }
}

function openImportDialog() {
  importInput.value?.click();
}

async function createRoom(payload: { title: string; guestName?: string; guestKey?: string }) {
  const slug = await roomStore.createRoom({
    ...payload,
    token: authStore.accessToken,
  });

  await router.push(`/room/${slug}`);
}

async function openRoom() {
  const normalized = roomLink.value.trim();

  if (!normalized) {
    return;
  }

  const roomSlug = normalized.split('/').filter(Boolean).at(-1);

  if (!roomSlug) {
    return;
  }

  await router.push(`/room/${roomSlug}`);
}
</script>

<template>
  <main class="page-shell">
    <section class="hero-panel">
      <div>
        <p class="eyebrow">D&D Canvas</p>
        <h1>Общий холст для настольных компаний</h1>
        <p class="hero-copy">
          Создавайте комнату, отправляйте ссылку группе и подключайте игроков как по аккаунту,
          так и по гостевому имени. Холст синхронизируется между всеми участниками в реальном
          времени.
        </p>
      </div>

      <form class="quick-link" @submit.prevent="openRoom">
        <label class="field">
          <span>Ссылка или код комнаты</span>
          <input v-model.trim="roomLink" type="text" placeholder="http://localhost:5173/room/abc123" />
        </label>
        <button class="ghost-button" type="submit">Открыть комнату</button>
      </form>
    </section>

    <section class="two-column-grid">
      <AuthPanel />
      <CreateRoomPanel @create="createRoom" />
    </section>

    <section v-if="authStore.user" class="import-room panel">
      <p class="eyebrow">Резервная копия</p>
      <h2>Импорт комнаты</h2>
      <p class="hero-copy">
        Загрузите JSON, ранее выгруженный владельцем комнаты. Будет создана новая комната в вашем аккаунте.
      </p>
      <input
        ref="importInput"
        type="file"
        accept="application/json,.json"
        class="visually-hidden"
        @change="onImportPick"
      />
      <button class="ghost-button" type="button" @click="openImportDialog">
        Выбрать файл…
      </button>
      <p v-if="importError" class="error-text">{{ importError }}</p>
    </section>

    <p v-if="roomStore.error" class="error-text centered">{{ roomStore.error }}</p>
  </main>
</template>
