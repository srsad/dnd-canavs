<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import CanvasBoard from '../components/CanvasBoard.vue';
import ChatPanel from '../components/ChatPanel.vue';
import CanvasHistoryPanel from '../components/CanvasHistoryPanel.vue';
import DiceLogPanel from '../components/DiceLogPanel.vue';
import DiceRoller from '../components/DiceRoller.vue';
import ParticipantsPanel from '../components/ParticipantsPanel.vue';
import { loadRoomGuestSnapshot } from '../lib/roomGuestStorage';
import { useAuthStore } from '../stores/auth';
import { useRoomStore } from '../stores/room';
import type { ParticipantPresence, RoomCanvas } from '../types';

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

const gmPresence = computed<ParticipantPresence | null>(() => {
  const gmId = roomStore.room?.createdBy.id;
  if (!gmId) {
    return null;
  }
  const row = roomStore.participants.find((p) => p.id === gmId);
  return row?.presence ?? 'offline';
});

const showGmOfflineNotice = computed(
  () =>
    Boolean(
      gmPresence.value &&
        gmPresence.value !== 'online' &&
        roomStore.currentParticipant?.role !== 'gm',
    ),
);

const canUseRealtime = computed(
  () => connected.value && roomStore.isRealtimeConnected,
);

const isGm = computed(() => roomStore.currentParticipant?.role === 'gm');

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

    const snap = loadRoomGuestSnapshot(nextSlug);
    if (snap?.guestName && !isRegisteredUser.value && !guestName.value.trim()) {
      guestName.value = snap.guestName;
    }

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

function retryRealtime() {
  roomStore.socket?.connect();
}

async function fullSessionRefresh() {
  await roomStore.refreshRoomSession({
    slug: slug.value,
    guestName: isRegisteredUser.value ? undefined : guestName.value,
    token: authStore.accessToken,
  });
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
      <div
        v-if="connected && roomStore.lostRealtime"
        class="realtime-banner panel"
        role="status"
      >
        <p>
          Связь с сервером потеряна. Обычно соединение восстанавливается само; если нет — запросите
          новую сессию.
        </p>
        <div class="realtime-banner__actions">
          <button class="ghost-button" type="button" @click="retryRealtime">Переподключить</button>
          <button class="primary-button" type="button" :disabled="roomStore.loading" @click="fullSessionRefresh">
            Новая сессия
          </button>
        </div>
      </div>

      <div v-if="showGmOfflineNotice" class="gm-offline-banner panel" role="status">
        <p>Мастер сейчас не в сети или отошёл. Холст доступен для просмотра; правки мастера появятся, когда он подключится.</p>
      </div>

      <CanvasBoard
        v-model="canvasModel"
        :participant-id="roomStore.currentParticipant?.id ?? 'unknown'"
        :can-edit="roomStore.currentParticipant?.role === 'gm' && roomStore.isRealtimeConnected"
        :participants="roomStore.participants"
        @commit-token-moves="roomStore.moveTokens"
      />

      <div class="room-sidebar">
        <ParticipantsPanel
          :participants="roomStore.participants"
          :current-participant-id="roomStore.currentParticipant?.id"
        />

        <CanvasHistoryPanel
          :history="(roomStore.room?.canvasHistory ?? [])"
          :can-apply="roomStore.currentParticipant?.role === 'gm' && !replayCanvas && roomStore.isRealtimeConnected"
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
          :can-send="canUseRealtime"
          @send="roomStore.sendChat"
        />

        <DiceRoller />

        <DiceLogPanel :logs="(roomStore.room?.diceLogs ?? [])" />

        <section v-if="isGm" class="panel">
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
