<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import CanvasBoard from '../components/CanvasBoard.vue';
import ChatPanel from '../components/ChatPanel.vue';
import CanvasHistoryPanel from '../components/CanvasHistoryPanel.vue';
import DiceLogPanel from '../components/DiceLogPanel.vue';
import DiceRoller from '../components/DiceRoller.vue';
import ParticipantsPanel from '../components/ParticipantsPanel.vue';
import { useAuthStore } from '../stores/auth';
import { useRoomStore } from '../stores/room';
import type { RoomCanvas } from '../types';

const route = useRoute();
const authStore = useAuthStore();
const roomStore = useRoomStore();

const slug = computed(() => String(route.params.slug));
const guestName = ref('');
const connected = ref(false);
const replayCanvas = ref<RoomCanvas | null>(null);

const canvasModel = computed<RoomCanvas>({
  get() {
    if (replayCanvas.value) {
      return replayCanvas.value;
    }

    return roomStore.room?.canvas ?? {
      backgroundColor: '#f8f1df',
      gridEnabled: true,
      tokens: [],
      layers: [],
      fogEnabled: false,
      fogStrokes: [],
    };
  },
  set(value) {
    if (replayCanvas.value) {
      return;
    }
    roomStore.replaceCanvas(value);
  },
});

const isRegisteredUser = computed(() => Boolean(authStore.user));
const roomUrl = computed(() => `${window.location.origin}/room/${slug.value}`);
const canRenderBoard = computed(
  () => connected.value && roomStore.room && roomStore.currentParticipant,
);

watch(
  slug,
  async (nextSlug) => {
    const hasExistingSession =
      roomStore.room?.slug === nextSlug && Boolean(roomStore.sessionId);

    connected.value = false;

    if (!hasExistingSession) {
      roomStore.reset();
    }

    await roomStore.fetchRoom(nextSlug);

    if (hasExistingSession) {
      roomStore.connectRealtime();
      connected.value = true;
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await authStore.fetchMe();
});

onBeforeUnmount(() => {
  roomStore.disconnectRealtime();
});

async function connectToRoom() {
  await roomStore.joinRoom({
    slug: slug.value,
    guestName: isRegisteredUser.value ? undefined : guestName.value,
    token: authStore.accessToken,
  });

  roomStore.connectRealtime();
  connected.value = true;
}

async function copyLink() {
  await navigator.clipboard.writeText(roomUrl.value);
}
</script>

<template>
  <main class="page-shell room-page">
    <section class="room-header panel">
      <div>
        <p class="eyebrow">Комната</p>
        <h4>{{ roomStore.room?.title ?? 'Загрузка...' }}</h4>
      </div>

      <button class="ghost-button" type="button" @click="copyLink">Скопировать ссылку</button>
    </section>

    <section v-if="roomStore.room && !connected" class="connection-layout">
      <section class="panel">
        <p class="eyebrow">Подключение</p>
        <h2>{{ isRegisteredUser ? 'Вы входите как зарегистрированный пользователь' : 'Гостевой вход' }}</h2>

        <div v-if="authStore.user" class="account-badge">
          <strong>{{ authStore.user.displayName }}</strong>
          <span>{{ authStore.user.email }}</span>
        </div>

        <form v-else class="stack" @submit.prevent="connectToRoom">
          <label class="field">
            <span>Ваше имя</span>
            <input v-model.trim="guestName" type="text" minlength="2" placeholder="Имя гостя" required />
          </label>
        </form>

        <button class="primary-button" type="button" :disabled="roomStore.loading" @click="connectToRoom">
          Подключиться
        </button>

        <p v-if="roomStore.error" class="error-text">{{ roomStore.error }}</p>
      </section>

      <ParticipantsPanel
        :participants="roomStore.participants"
        :current-participant-id="roomStore.currentParticipant?.id"
      />
    </section>

    <section v-else-if="canRenderBoard" class="board-layout">
      <CanvasBoard
        v-model="canvasModel"
        :participant-id="roomStore.currentParticipant?.id ?? 'unknown'"
        :can-edit="roomStore.currentParticipant?.role === 'gm'"
      />

      <div class="room-sidebar">
        <ParticipantsPanel
          :participants="roomStore.participants"
          :current-participant-id="roomStore.currentParticipant?.id"
        />

        <CanvasHistoryPanel
          :history="(roomStore.room?.canvasHistory ?? [])"
          :can-apply="roomStore.currentParticipant?.role === 'gm' && !replayCanvas"
          @preview="replayCanvas = $event"
          @apply="
            (canvas) => {
              replayCanvas = null;
              roomStore.replaceCanvas(canvas);
            }
          "
        />

        <ChatPanel
          :messages="(roomStore.room?.chatMessages ?? [])"
          :can-send="connected"
          @send="roomStore.sendChat"
        />

        <DiceRoller />

        <DiceLogPanel :logs="(roomStore.room?.diceLogs ?? [])" />

        <section class="panel">
          <p class="eyebrow">Состояние</p>
          <h3>Синхронизация</h3>
          <p class="panel__copy">
            {{ roomStore.syncing ? 'Изменения отправляются...' : 'Холст синхронизирован.' }}
          </p>
        </section>
      </div>
    </section>
  </main>
</template>
