<script setup lang="ts">
import { computed, ref } from 'vue';
import { effectivePermissions } from '../lib/participantPermissions';
import { useRoomStore } from '../stores/room';
import type { Participant, ParticipantPresence } from '../types';

const roomStore = useRoomStore();

const props = defineProps<{
  participants: Participant[];
  currentParticipantId?: string | null;
  /** Room owner (createdBy) may edit ACL for other participants */
  isRoomOwner?: boolean;
  roomOwnerId?: string | null;
  roomSlug?: string | null;
  authToken?: string | null;
  hostSecret?: string | null;
}>();

const emit = defineEmits<{
  aclUpdated: [];
}>();

const aclBusyId = ref<string | null>(null);
const aclError = ref<string | null>(null);

const editableTargets = computed(() => {
  if (!props.isRoomOwner || !props.roomOwnerId) {
    return [];
  }
  return props.participants.filter(
    (p) => p.id !== props.roomOwnerId && p.role === 'player',
  );
});

function presenceLabel(presence: ParticipantPresence | undefined) {
  switch (presence ?? 'offline') {
    case 'online':
      return 'онлайн';
    case 'away':
      return 'отошёл';
    default:
      return 'офлайн';
  }
}

function permState(p: Participant) {
  return effectivePermissions(p);
}

async function setPermission(
  participantId: string,
  key: 'editCanvas' | 'moveAnyToken',
  value: boolean,
) {
  aclError.value = null;
  aclBusyId.value = participantId;
  try {
    await roomStore.patchParticipantPermissions({
      participantId,
      token: props.authToken,
      hostSecret: props.hostSecret ?? undefined,
      permissions: { [key]: value },
    });
    await roomStore.fetchRoom(props.roomSlug!);
    emit('aclUpdated');
  } catch (e) {
    aclError.value = e instanceof Error ? e.message : 'Не удалось обновить права.';
  } finally {
    aclBusyId.value = null;
  }
}

async function clearAcl(participantId: string) {
  aclError.value = null;
  aclBusyId.value = participantId;
  try {
    await roomStore.patchParticipantPermissions({
      participantId,
      token: props.authToken,
      hostSecret: props.hostSecret ?? undefined,
      clear: true,
    });
    await roomStore.fetchRoom(props.roomSlug!);
    emit('aclUpdated');
  } catch (e) {
    aclError.value = e instanceof Error ? e.message : 'Не удалось сбросить права.';
  } finally {
    aclBusyId.value = null;
  }
}
</script>

<template>
  <aside class="panel participants-panel">
    <p class="eyebrow">Участники</p>
    <h3>В комнате сейчас</h3>

    <ul class="participants-list">
      <li v-for="participant in participants" :key="participant.id">
        <span
          class="presence-dot"
          :class="`presence--${participant.presence ?? 'offline'}`"
          :title="presenceLabel(participant.presence)"
          aria-hidden="true"
        />
        <div>
          <strong>{{ participant.displayName }}</strong>
          <span>
            {{ participant.role === 'gm' ? 'GM' : 'игрок' }}
            ·
            {{ participant.kind === 'registered' ? 'аккаунт' : 'гость' }}
            ·
            {{ presenceLabel(participant.presence) }}
          </span>
        </div>
        <mark v-if="participant.id === currentParticipantId">Вы</mark>
      </li>
    </ul>

    <template v-if="isRoomOwner && editableTargets.length">
      <p class="eyebrow acl-heading">Права игроков</p>
      <p class="acl-hint">
        Дополнительные возможности поверх роли «игрок». Сброс возвращает настройки по умолчанию.
      </p>
      <p v-if="aclError" class="error-text">{{ aclError }}</p>
      <ul class="acl-list">
        <li v-for="p in editableTargets" :key="p.id" class="acl-row">
          <div class="acl-row__title">{{ p.displayName }}</div>
          <label class="acl-check">
            <input
              type="checkbox"
              :checked="permState(p).editCanvas"
              :disabled="aclBusyId === p.id"
              @change="setPermission(p.id, 'editCanvas', ($event.target as HTMLInputElement).checked)"
            />
            <span>Холст</span>
          </label>
          <label class="acl-check">
            <input
              type="checkbox"
              :checked="permState(p).moveAnyToken"
              :disabled="aclBusyId === p.id"
              @change="setPermission(p.id, 'moveAnyToken', ($event.target as HTMLInputElement).checked)"
            />
            <span>Все фишки</span>
          </label>
          <button
            type="button"
            class="ghost-button acl-reset"
            :disabled="aclBusyId === p.id"
            @click="clearAcl(p.id)"
          >
            Сброс
          </button>
        </li>
      </ul>
    </template>
  </aside>
</template>

<style scoped>
.acl-heading {
  margin-top: 1rem;
}

.acl-hint {
  font-size: 0.85rem;
  color: var(--muted, #64748b);
  margin: 0.25rem 0 0.75rem;
}

.acl-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.acl-row {
  display: grid;
  gap: 0.35rem;
  padding: 0.5rem 0;
  border-top: 1px solid rgba(148, 163, 184, 0.35);
}

.acl-row__title {
  font-weight: 600;
  font-size: 0.9rem;
}

.acl-check {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  cursor: pointer;
}

.acl-reset {
  justify-self: start;
  font-size: 0.8rem;
  padding: 0.2rem 0.5rem;
}
</style>
