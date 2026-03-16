<script setup lang="ts">
import { ref } from 'vue';
import { useRoomStore } from '../stores/room';

const roomStore = useRoomStore();

const DICE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

const selectedDice = ref('d6');
const count = ref(1);

function roll() {
  roomStore.rollDice(selectedDice.value, count.value);
}
</script>

<template>
  <section class="panel dice-roller">
    <p class="eyebrow">Бросок костей</p>
    <h3>Кости</h3>

    <div class="dice-selector">
      <label class="field compact">
        <span>Тип</span>
        <select v-model="selectedDice" class="dice-select">
          <option v-for="d of DICE_TYPES" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>

      <label class="field compact">
        <span>Кол-во</span>
        <input v-model.number="count" type="number" min="1" max="20" class="dice-count" />
      </label>

      <button class="primary-button dice-roll-btn" type="button" @click="roll">
        Бросить
      </button>
    </div>
  </section>
</template>

<style scoped>
.dice-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}

.dice-select,
.dice-count {
  min-width: 80px;
}

.dice-select {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.55);
  color: #f8fafc;
  padding: 0.85rem 1rem;
  cursor: pointer;
}

.dice-select:focus {
  outline: 2px solid rgba(167, 139, 250, 0.85);
  outline-offset: 1px;
}

.dice-roll-btn {
  padding: 0.85rem 1.5rem;
}
</style>
