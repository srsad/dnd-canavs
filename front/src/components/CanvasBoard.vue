<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { RoomCanvas, Stroke, Token } from '../types';

const props = defineProps<{
  modelValue: RoomCanvas;
  participantId: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: RoomCanvas];
}>();

const WIDTH = 960;
const HEIGHT = 600;

const boardRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const localCanvas = ref<RoomCanvas>(cloneCanvas(props.modelValue));
const brushColor = ref('#111827');
const brushWidth = ref(4);

let activeStroke: Stroke | null = null;
let activeTokenId: string | null = null;

watch(
  () => props.modelValue,
  async (value) => {
    localCanvas.value = cloneCanvas(value);
    await nextTick();
    renderCanvas();
  },
  { deep: true, immediate: true },
);

watch([brushColor, brushWidth], () => {
  renderCanvas();
});

function toggleGrid() {
  updateCanvas({
    ...localCanvas.value,
    gridEnabled: !localCanvas.value.gridEnabled,
  });
}

function clearBoard() {
  updateCanvas({
    ...localCanvas.value,
    strokes: [],
  });
}

function addToken() {
  const newToken: Token = {
    id: crypto.randomUUID(),
    label: `T${localCanvas.value.tokens.length + 1}`,
    color: '#dc2626',
    x: 120 + localCanvas.value.tokens.length * 20,
    y: 120 + localCanvas.value.tokens.length * 20,
    size: 42,
  };

  updateCanvas({
    ...localCanvas.value,
    tokens: [...localCanvas.value.tokens, newToken],
  });
}

function startDrawing(event: PointerEvent) {
  if (activeTokenId) {
    return;
  }

  const point = getRelativePoint(event);
  activeStroke = {
    id: crypto.randomUUID(),
    color: brushColor.value,
    width: brushWidth.value,
    authorId: props.participantId,
    points: [point],
  };
}

function draw(event: PointerEvent) {
  if (!activeStroke) {
    return;
  }

  activeStroke.points.push(getRelativePoint(event));

  localCanvas.value = {
    ...localCanvas.value,
    strokes: [
      ...localCanvas.value.strokes.filter((stroke) => stroke.id !== activeStroke?.id),
      activeStroke,
    ],
  };

  renderCanvas();
}

function finishDrawing() {
  if (!activeStroke) {
    return;
  }

  updateCanvas({
    ...localCanvas.value,
    strokes: [
      ...localCanvas.value.strokes.filter((stroke) => stroke.id !== activeStroke?.id),
      activeStroke,
    ],
  });

  activeStroke = null;
}

function startTokenDrag(tokenId: string, event: PointerEvent) {
  event.stopPropagation();
  activeTokenId = tokenId;
}

function handlePointerMove(event: PointerEvent) {
  if (activeTokenId) {
    const point = getRelativePoint(event);

    localCanvas.value = {
      ...localCanvas.value,
      tokens: localCanvas.value.tokens.map((token) =>
        token.id === activeTokenId
          ? {
              ...token,
              x: point.x,
              y: point.y,
            }
          : token,
      ),
    };

    renderCanvas();
    return;
  }

  draw(event);
}

function finishInteraction() {
  if (activeTokenId) {
    updateCanvas(localCanvas.value);
    activeTokenId = null;
  }

  finishDrawing();
}

function updateCanvas(value: RoomCanvas) {
  localCanvas.value = cloneCanvas(value);
  renderCanvas();
  emit('update:modelValue', cloneCanvas(value));
}

function renderCanvas() {
  const canvas = canvasRef.value;
  const context = canvas?.getContext('2d');

  if (!canvas || !context) {
    return;
  }

  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = localCanvas.value.backgroundColor;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  if (localCanvas.value.gridEnabled) {
    context.strokeStyle = 'rgba(15, 23, 42, 0.08)';
    context.lineWidth = 1;

    for (let x = 0; x <= WIDTH; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, HEIGHT);
      context.stroke();
    }

    for (let y = 0; y <= HEIGHT; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(WIDTH, y);
      context.stroke();
    }
  }

  for (const stroke of localCanvas.value.strokes) {
    if (stroke.points.length === 0) {
      continue;
    }

    context.beginPath();
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    stroke.points.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });

    context.stroke();
  }
}

function getRelativePoint(event: PointerEvent) {
  const rect = boardRef.value?.getBoundingClientRect();

  if (!rect) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.max(0, Math.min(WIDTH, event.clientX - rect.left)),
    y: Math.max(0, Math.min(HEIGHT, event.clientY - rect.top)),
  };
}

function cloneCanvas(value: RoomCanvas): RoomCanvas {
  return {
    backgroundColor: value.backgroundColor,
    gridEnabled: value.gridEnabled,
    strokes: value.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
    tokens: value.tokens.map((token) => ({ ...token })),
  };
}

const tokenStyle = computed(() =>
  localCanvas.value.tokens.map((token) => ({
    ...token,
    style: {
      left: `${token.x - token.size / 2}px`,
      top: `${token.y - token.size / 2}px`,
      width: `${token.size}px`,
      height: `${token.size}px`,
      backgroundColor: token.color,
    },
  })),
);

onBeforeUnmount(() => {
  activeStroke = null;
  activeTokenId = null;
});
</script>

<template>
  <section class="panel board-panel">
    <div class="board-toolbar">
      <div class="toolbar-group">
        <label class="field compact">
          <span>Кисть</span>
          <input v-model="brushColor" type="color" />
        </label>
        <label class="field compact">
          <span>Толщина</span>
          <input v-model.number="brushWidth" type="range" min="2" max="12" />
        </label>
      </div>

      <div class="toolbar-group">
        <button class="ghost-button" type="button" @click="toggleGrid">
          {{ localCanvas.gridEnabled ? 'Скрыть сетку' : 'Показать сетку' }}
        </button>
        <button class="ghost-button" type="button" @click="addToken">Добавить фишку</button>
        <button class="ghost-button" type="button" @click="clearBoard">Очистить линии</button>
      </div>
    </div>

    <div
      ref="boardRef"
      class="board-surface"
      @pointerdown="startDrawing"
      @pointermove="handlePointerMove"
      @pointerup="finishInteraction"
      @pointerleave="finishInteraction"
    >
      <canvas ref="canvasRef" :width="WIDTH" :height="HEIGHT" class="battle-canvas" />

      <button
        v-for="token in tokenStyle"
        :key="token.id"
        class="token-chip"
        :style="token.style"
        type="button"
        @pointerdown="startTokenDrag(token.id, $event)"
      >
        {{ token.label }}
      </button>
    </div>
  </section>
</template>
