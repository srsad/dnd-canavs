<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '../stores/auth';

const emit = defineEmits<{
  create: [payload: { title: string; guestName?: string }];
}>();

const authStore = useAuthStore();
const title = ref('');
const guestName = ref('');

const isGuestFlow = computed(() => !authStore.user);

function submit() {
  emit('create', {
    title: title.value,
    guestName: isGuestFlow.value ? guestName.value : undefined,
  });
}
</script>

<template>
  <section class="panel">
    <p class="eyebrow">Старт</p>
    <h2>Создать новую комнату</h2>
    <p class="panel__copy">
      Мастер или игрок создаёт комнату, получает ссылку и делится ей с остальной группой.
    </p>

    <form class="stack" @submit.prevent="submit">
      <label class="field">
        <span>Название комнаты</span>
        <input v-model.trim="title" type="text" placeholder="Подземелье под Ривервудом" required />
      </label>

      <label v-if="isGuestFlow" class="field">
        <span>Имя гостя</span>
        <input v-model.trim="guestName" type="text" minlength="2" placeholder="Безымянный бард" required />
      </label>

      <button class="primary-button" type="submit">Создать и перейти</button>
    </form>
  </section>
</template>
