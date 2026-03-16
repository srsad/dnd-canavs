<script setup lang="ts">
import { computed } from 'vue';
import type { DiceRollLog } from '../types';

const props = defineProps<{
  logs: DiceRollLog[];
}>();

const sortedLogs = computed(() =>
  [...props.logs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  ),
);

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRoll(log: DiceRollLog) {
  const expr = log.count > 1 ? `${log.count}${log.diceType}` : log.diceType;
  const details =
    log.results.length > 1
      ? ` (${log.results.join(' + ')}) = ${log.total}`
      : '';
  return `${expr}${details}`;
}
</script>

<template>
  <section class="panel dice-log-panel">
    <p class="eyebrow">История</p>
    <h3>Броски костей</h3>

    <ul v-if="sortedLogs.length" class="dice-log-list">
      <li v-for="log in sortedLogs" :key="log.id" class="dice-log-item">
        <div class="dice-log-header">
          <strong class="dice-log-player">{{ log.participantDisplayName }}</strong>
          <span class="dice-log-time">{{ formatTime(log.createdAt) }}</span>
        </div>
        <div class="dice-log-roll">
          <code>{{ formatRoll(log) }}</code>
          <span v-if="log.results.length > 1" class="dice-log-total">= {{ log.total }}</span>
          <span v-else class="dice-log-total">{{ log.total }}</span>
        </div>
      </li>
    </ul>
    <p v-else class="panel__copy">Пока нет бросков.</p>
  </section>
</template>

<style scoped>
.dice-log-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
  max-height: 240px;
  overflow-y: auto;
}

.dice-log-item {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.dice-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.dice-log-player {
  color: #f8fafc;
  font-size: 0.9rem;
}

.dice-log-time {
  color: #94a3b8;
  font-size: 0.8rem;
}

.dice-log-roll {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dice-log-roll code {
  font-size: 0.95rem;
}

.dice-log-total {
  font-weight: 700;
  color: #c4b5fd;
}
</style>
