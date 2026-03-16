import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import { apiRequest } from '../lib/api';
import { createRoomSocket } from '../lib/socket';
import type {
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
    token?: string | null;
  }) {
    loading.value = true;
    error.value = null;

    try {
      const response = await apiRequest<Omit<JoinRoomResponse, 'participants'>>('/rooms', {
        method: 'POST',
        token: payload.token,
        body: {
          title: payload.title,
          guestName: payload.guestName,
        },
      });

      room.value = response.room;
      currentParticipant.value = response.participant;
      sessionId.value = response.sessionId;
      participants.value = [response.participant];
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
    token?: string | null;
  }) {
    loading.value = true;
    error.value = null;

    try {
      const response = await apiRequest<JoinRoomResponse>(
        `/rooms/${payload.slug}/join`,
        {
          method: 'POST',
          token: payload.token,
          body: {
            guestName: payload.guestName,
          },
        },
      );

      room.value = response.room;
      currentParticipant.value = response.participant;
      sessionId.value = response.sessionId;
      participants.value = response.participants;
      return response;
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : 'Join failed.';
      throw caughtError;
    } finally {
      loading.value = false;
    }
  }

  function connectRealtime() {
    if (!room.value?.slug || !sessionId.value) {
      return;
    }

    disconnectRealtime();

    const nextSocket = createRoomSocket(room.value.slug, sessionId.value);

    nextSocket.on('room_state', (payload: { room: Room; participants: Participant[] }) => {
      room.value = payload.room;
      participants.value = payload.participants;
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

    nextSocket.on('connect_error', () => {
      error.value = 'Realtime connection failed.';
    });

    socket.value = nextSocket;
  }

  function replaceCanvas(canvas: RoomCanvas) {
    if (!room.value) {
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
  }

  const canConnect = computed(() => Boolean(room.value && sessionId.value));

  let syncTimerId = 0;

  return {
    canConnect,
    connectRealtime,
    createRoom,
    currentParticipant,
    disconnectRealtime,
    error,
    fetchRoom,
    joinRoom,
    loading,
    participants,
    replaceCanvas,
    reset,
    room,
    sessionId,
    syncing,
  };
});
