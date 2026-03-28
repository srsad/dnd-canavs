<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import AuthPanel from '../components/AuthPanel.vue';
import CreateRoomPanel from '../components/CreateRoomPanel.vue';
import { useAuthStore } from '../stores/auth';
import { useRoomStore } from '../stores/room';

const router = useRouter();
const authStore = useAuthStore();
const roomStore = useRoomStore();
const roomLink = ref('');

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
        <h1>Общий холст для настольных кампаний</h1>
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

    <p v-if="roomStore.error" class="error-text centered">{{ roomStore.error }}</p>
  </main>
</template>
