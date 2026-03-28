import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import { apiRequest } from '../lib/api';
import { createRoomSocket } from '../lib/socket';
import {
  loadRoomGuestSnapshot,
  saveRoomGuestSnapshot,
} from '../lib/roomGuestStorage';
import type {
  ChatMessage,
  CreateRoomApiResponse,
  DiceRollLog,
  JoinRoomResponse,
  Participant,
  Room,
  RoomCanvas,
  RoomSummaryResponse,
} from '../types';

export const useRoomStore = defineStore('room', () => {
  const room = ref<Room | null>(null);
  const participants = ref<Participant[]>([]);
  const currentParticipant = ref<Participant | null>(null);
  const sessionId = ref<string | null>(null);
  const loading = ref(false);
  const syncing = ref(false);
  const error = ref<string | null>(null);
  const socket = shallowRef<Socket | null>(null);
  const lostRealtime = ref(false);

  async function fetchRoom(slug: string) {
    loading.value = true;
    error.value = null;

    try {
      const response = await apiRequest<RoomSummaryResponse>(`/rooms/${slug}`);
      room.value = response.room;
      participants.value = response.participants;
      return response;
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : 'Room load failed.';
      throw caughtError;
    } finally {
      loading.value = false;
    }
  }

  async function createRoom(payload: {
    title: string;
    guestName?: string;
    guestKey?: string;
    token?: string | null;
  }) {
    loading.value = true;
    error.value = null;

    try {
      const response = await apiRequest<CreateRoomApiResponse>('/rooms', {
        method: 'POST',
        token: payload.token,
        body: {
          title: payload.title,
          guestName: payload.guestName,
          guestKey: payload.guestKey,
        },
      });

      room.value = response.room;
      currentParticipant.value = response.participant;
      sessionId.value = response.sessionId;
      participants.value = [
        {
          ...response.participant,
          presence: 'offline',
        },
      ];

      if (response.participant.kind === 'guest' && response.guestKey) {
        saveRoomGuestSnapshot(response.room.slug, {
          guestKey: response.guestKey,
          guestName: response.participant.displayName,
          hostSecret: response.hostSecret,
        });
      }

      return response.room.slug;
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : 'Room creation failed.';
      throw caughtError;
    } finally {
      loading.value = false;
    }
  }

  async function joinRoom(payload: {
    slug: string;
    guestName?: string;
    guestKey?: string;
    hostSecret?: string;
    token?: string | null;
  }) {
    loading.value = true;
    error.value = null;

    try {
      const isRegistered = Boolean(payload.token);
      const snap = isRegistered ? null : loadRoomGuestSnapshot(payload.slug);

      const response = await apiRequest<JoinRoomResponse>(
        `/rooms/${payload.slug}/join`,
        {
          method: 'POST',
          token: payload.token,
          body: {
            guestName: payload.guestName ?? snap?.guestName,
            guestKey: isRegistered ? undefined : (payload.guestKey ?? snap?.guestKey),
            hostSecret: isRegistered ? undefined : (payload.hostSecret ?? snap?.hostSecret),
          },
        },
      );

      room.value = response.room;
      currentParticipant.value = response.participant;
      sessionId.value = response.sessionId;
      participants.value = response.participants;

      if (response.participant.kind === 'guest' && response.guestKey) {
        const prev = loadRoomGuestSnapshot(payload.slug);
        saveRoomGuestSnapshot(payload.slug, {
          guestKey: response.guestKey,
          guestName: response.participant.displayName,
          hostSecret: prev?.hostSecret,
        });
      }

      return response;
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : 'Join failed.';
      throw caughtError;
    } finally {
      loading.value = false;
    }
  }

  async function refreshRoomSession(opts: {
    slug: string;
    guestName?: string;
    token?: string | null;
  }) {
    disconnectRealtime();
    await joinRoom({
      slug: opts.slug,
      guestName: opts.guestName,
      token: opts.token,
    });
    connectRealtime();
  }

  function connectRealtime() {
    if (!room.value?.slug || !sessionId.value) {
      return;
    }

    disconnectRealtime();

    const nextSocket = createRoomSocket(() => {
      const slug = room.value?.slug;
      const sid = sessionId.value;
      if (!slug || !sid) {
        return null;
      }
      return { roomSlug: slug, sessionId: sid };
    });

    nextSocket.on('room_state', (payload: { room: Room; participants: Participant[] }) => {
      room.value = payload.room;
      participants.value = payload.participants;
    });

    nextSocket.on('dice_log_added', (payload: { log: DiceRollLog }) => {
      if (!room.value) return;
      const logs = room.value.diceLogs ?? [];
      room.value = {
        ...room.value,
        diceLogs: [...logs, payload.log],
      };
    });

    nextSocket.on('presence_updated', (payload: { participants: Participant[] }) => {
      participants.value = payload.participants;
    });

    nextSocket.on('canvas_updated', (payload: { canvas: RoomCanvas }) => {
      if (!room.value) {
        return;
      }

      room.value = {
        ...room.value,
        canvas: payload.canvas,
      };
    });

    nextSocket.on('chat:message', (payload: { message: ChatMessage }) => {
      if (!room.value) return;
      const messages = room.value.chatMessages ?? [];
      room.value = {
        ...room.value,
        chatMessages: [...messages, payload.message].slice(-100),
      };
    });

    nextSocket.on('connect', () => {
      lostRealtime.value = false;
      error.value = null;
    });

    nextSocket.on('disconnect', () => {
      lostRealtime.value = true;
    });

    nextSocket.on('connect_error', () => {
      error.value = 'Realtime connection failed.';
    });

    socket.value = nextSocket;

    if (nextSocket.connected) {
      lostRealtime.value = false;
    }
  }

  function rollDice(diceType: string, count = 1) {
    socket.value?.emit('dice:roll', { diceType, count });
  }

  function sendChat(text: string) {
    socket.value?.emit('chat:send', { text });
  }

  function moveTokens(moves: Array<{ id: string; x: number; y: number }>) {
    if (!moves.length || !socket.value?.connected) {
      return;
    }
    socket.value.emit('tokens:move', { moves });
  }

  function replaceCanvas(canvas: RoomCanvas) {
    if (!room.value) {
      return;
    }

    if (currentParticipant.value?.role !== 'gm') {
      return;
    }

    if (!socket.value?.connected) {
      return;
    }

    room.value = {
      ...room.value,
      canvas,
    };

    syncing.value = true;
    socket.value?.emit('canvas:replace', { canvas });
    window.clearTimeout(syncTimerId);
    syncTimerId = window.setTimeout(() => {
      syncing.value = false;
    }, 300);
  }

  function disconnectRealtime() {
    socket.value?.disconnect();
    socket.value = null;
  }

  function reset() {
    disconnectRealtime();
    room.value = null;
    participants.value = [];
    currentParticipant.value = null;
    sessionId.value = null;
    error.value = null;
    lostRealtime.value = false;
  }

  const canConnect = computed(() => Boolean(room.value && sessionId.value));

  const isRealtimeConnected = computed(() => Boolean(socket.value?.connected));

  let syncTimerId = 0;

  return {
    canConnect,
    connectRealtime,
    createRoom,
    currentParticipant,
    disconnectRealtime,
    error,
    fetchRoom,
    isRealtimeConnected,
    joinRoom,
    loading,
    lostRealtime,
    participants,
    refreshRoomSession,
    replaceCanvas,
    reset,
    rollDice,
    sendChat,
    moveTokens,
    room,
    sessionId,
    socket,
    syncing,
  };
});
