<script setup lang="ts">
import type { Participant } from '../types';

defineProps<{
  participants: Participant[];
  currentParticipantId?: string | null;
}>();
</script>

<template>
  <aside class="panel participants-panel">
    <p class="eyebrow">Участники</p>
    <h3>В комнате сейчас</h3>

    <ul class="participants-list">
      <li v-for="participant in participants" :key="participant.id">
        <div>
          <strong>{{ participant.displayName }}</strong>
          <span>
            {{ participant.role === 'gm' ? 'GM' : 'игрок' }}
            ·
            {{ participant.kind === 'registered' ? 'аккаунт' : 'гость' }}
          </span>
        </div>
        <mark v-if="participant.id === currentParticipantId">Вы</mark>
      </li>
    </ul>
  </aside>
</template>
