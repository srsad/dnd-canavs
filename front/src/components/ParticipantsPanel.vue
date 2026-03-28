<script setup lang="ts">
import type { Participant, ParticipantPresence } from '../types';

defineProps<{
  participants: Participant[];
  currentParticipantId?: string | null;
}>();

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
  </aside>
</template>
