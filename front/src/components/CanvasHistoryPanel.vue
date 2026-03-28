<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RoomCanvas } from '../types';

const props = defineProps<{
  history: RoomCanvas[];
  canApply?: boolean;
}>();

const emit = defineEmits<{
  preview: [canvas: RoomCanvas | null];
  apply: [canvas: RoomCanvas];
}>();

const selectedIndex = ref<number | null>(null);

const items = computed(() => props.history.map((canvas, index) => ({ index, canvas })));

function select(index: number) {
  selectedIndex.value = index;
  emit('preview', props.history[index] ?? null);
}

function exitPreview() {
  selectedIndex.value = null;
  emit('preview', null);
}

function applySelected() {
  if (props.canApply === false) return;
  if (selectedIndex.value === null) return;
  const canvas = props.history[selectedIndex.value];
  if (!canvas) return;
  emit('apply', canvas);
}
</script>

<template>
  <section class="panel history-panel">
    <p class="eyebrow">История</p>
    <h3>Ходы (до 50)</h3>

    <div class="history-actions">
      <button class="ghost-button" type="button" :disabled="selectedIndex === null" @click="exitPreview">
        Выйти из просмотра
      </button>
      <button
        v-if="canApply === true"
        class="primary-button"
        type="button"
        :disabled="selectedIndex === null"
        @click="applySelected"
      >
        Применить выбранный
      </button>
    </div>

    <ul class="history-list">
      <li v-if="items.length === 0" class="history-empty">История пока пуста.</li>
      <li v-for="item in items" :key="item.index">
        <button
          class="ghost-button history-item"
          type="button"
          :class="{ active: item.index === selectedIndex }"
          @click="select(item.index)"
        >
          Ход {{ item.index + 1 }}
        </button>
      </li>
    </ul>
  </section>
</template>
