<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { ChatMessage } from '../types';

const props = defineProps<{
  messages: ChatMessage[];
  canSend?: boolean;
}>();

const emit = defineEmits<{
  send: [text: string];
}>();

const text = ref('');
const listRef = ref<HTMLUListElement | null>(null);

const sorted = computed(() =>
  [...props.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
);

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    listRef.value?.scrollTo({ top: listRef.value.scrollHeight });
  },
);

function submit() {
  if (props.canSend === false) return;
  const trimmed = text.value.trim();
  if (!trimmed) return;
  emit('send', trimmed);
  text.value = '';
}
</script>

<template>
  <section class="panel chat-panel">
    <p class="eyebrow">Чат</p>
    <h3>Сообщения</h3>

    <ul ref="listRef" class="chat-list">
      <li v-if="sorted.length === 0" class="chat-empty">Пока нет сообщений.</li>
      <li v-for="message in sorted" :key="message.id" class="chat-item">
        <div class="chat-meta">
          <strong>{{ message.participantDisplayName }}</strong>
          <time :datetime="message.createdAt">{{ new Date(message.createdAt).toLocaleTimeString() }}</time>
        </div>
        <p class="chat-text">{{ message.text }}</p>
      </li>
    </ul>

    <form class="chat-form" @submit.prevent="submit">
      <input
        v-model="text"
        type="text"
        :disabled="canSend === false"
        placeholder="Написать сообщение..."
        maxlength="1000"
      />
      <button class="ghost-button" type="submit" :disabled="canSend === false || !text.trim()">
        Отправить
      </button>
    </form>
  </section>
</template>
