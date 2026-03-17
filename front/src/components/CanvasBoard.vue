<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { RoomCanvas, Stroke, Token } from '../types';

const props = defineProps<{
  modelValue: RoomCanvas;
  participantId: string;
  canEdit?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: RoomCanvas];
}>();

const GRID_STEP = 40;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;

const boardRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const viewportSize = ref({ width: 960, height: 600 });
const localCanvas = ref<RoomCanvas>(cloneCanvas(props.modelValue));
const brushColor = ref('#111827');
const brushWidth = ref(4);

const pan = ref({ x: 0, y: 0 });
const zoom = ref(1);

let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
let isPanning = false;
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

watch([brushColor, brushWidth, viewportSize, pan, zoom], () => {
  renderCanvas();
});

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  const el = boardRef.value;
  if (!el) return;
  resizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[0]?.contentRect ?? { width: 960, height: 600 };
    viewportSize.value = { width: Math.max(1, width), height: Math.max(1, height) };
    nextTick(() => renderCanvas());
  });
  resizeObserver.observe(el);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  activeStroke = null;
  activeTokenId = null;
});

function toggleGrid() {
  if (props.canEdit === false) return;
  updateCanvas({
    ...localCanvas.value,
    gridEnabled: !localCanvas.value.gridEnabled,
  });
}

function clearBoard() {
  if (props.canEdit === false) return;
  updateCanvas({
    ...localCanvas.value,
    strokes: [],
  });
}

function addToken() {
  if (props.canEdit === false) return;
  const rect = boardRef.value?.getBoundingClientRect();
  const cx = rect ? (rect.width / 2 - pan.value.x) / zoom.value : 120;
  const cy = rect ? (rect.height / 2 - pan.value.y) / zoom.value : 120;

  const newToken: Token = {
    id: crypto.randomUUID(),
    label: `T${localCanvas.value.tokens.length + 1}`,
    color: '#dc2626',
    x: cx + localCanvas.value.tokens.length * 20,
    y: cy + localCanvas.value.tokens.length * 20,
    size: 42,
  };

  updateCanvas({
    ...localCanvas.value,
    tokens: [...localCanvas.value.tokens, newToken],
  });
}

function startDrawing(event: PointerEvent) {
  if (activeTokenId || isPanning) {
    return;
  }
  if (props.canEdit === false) return;

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

function startPointerDown(event: PointerEvent) {
  if (event.button === 1 || event.button === 2) {
    event.preventDefault();
    isPanning = true;
    panStart = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.value.x,
      panY: pan.value.y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
}

function handlePointerUp(event: PointerEvent) {
  if (event.button === 1 || event.button === 2) {
    isPanning = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }
  finishInteraction();
}

function handlePanMove(event: PointerEvent) {
  if (isPanning) {
    pan.value = {
      x: panStart.panX + event.clientX - panStart.x,
      y: panStart.panY + event.clientY - panStart.y,
    };
    return true;
  }
  return false;
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) return;

  const viewX = event.clientX - rect.left;
  const viewY = event.clientY - rect.top;
  const contentX = (viewX - pan.value.x) / zoom.value;
  const contentY = (viewY - pan.value.y) / zoom.value;

  const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value + delta));

  pan.value = {
    x: viewX - contentX * newZoom,
    y: viewY - contentY * newZoom,
  };
  zoom.value = newZoom;
}

function zoomIn() {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) return;
  const viewX = rect.width / 2;
  const viewY = rect.height / 2;
  const contentX = (viewX - pan.value.x) / zoom.value;
  const contentY = (viewY - pan.value.y) / zoom.value;
  const newZoom = Math.min(MAX_ZOOM, zoom.value + ZOOM_STEP);
  pan.value = {
    x: viewX - contentX * newZoom,
    y: viewY - contentY * newZoom,
  };
  zoom.value = newZoom;
}

function zoomOut() {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) return;
  const viewX = rect.width / 2;
  const viewY = rect.height / 2;
  const contentX = (viewX - pan.value.x) / zoom.value;
  const contentY = (viewY - pan.value.y) / zoom.value;
  const newZoom = Math.max(MIN_ZOOM, zoom.value - ZOOM_STEP);
  pan.value = {
    x: viewX - contentX * newZoom,
    y: viewY - contentY * newZoom,
  };
  zoom.value = newZoom;
}

function resetView() {
  pan.value = { x: 0, y: 0 };
  zoom.value = 1;
}

function startTokenDrag(tokenId: string, event: PointerEvent) {
  event.stopPropagation();
  activeTokenId = tokenId;
}

function handlePointerDown(event: PointerEvent) {
  if (event.button === 1 || event.button === 2) {
    startPointerDown(event);
  } else if (event.button === 0 && !activeTokenId) {
    if (props.canEdit === false) return;
    startDrawing(event);
  }
}

function handlePointerMove(event: PointerEvent) {
  if (handlePanMove(event)) return;
  if (props.canEdit === false && !activeTokenId) {
    return;
  }
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

  const { width, height } = viewportSize.value;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);

  context.setTransform(zoom.value, 0, 0, zoom.value, pan.value.x, pan.value.y);

  const worldLeft = -pan.value.x / zoom.value;
  const worldTop = -pan.value.y / zoom.value;
  const worldRight = (width - pan.value.x) / zoom.value;
  const worldBottom = (height - pan.value.y) / zoom.value;

  context.fillStyle = localCanvas.value.backgroundColor;
  context.fillRect(worldLeft - 1, worldTop - 1, worldRight - worldLeft + 2, worldBottom - worldTop + 2);

  if (localCanvas.value.gridEnabled) {
    context.strokeStyle = 'rgba(15, 23, 42, 0.08)';
    context.lineWidth = 1 / zoom.value;

    const gridStartX = Math.floor(worldLeft / GRID_STEP) * GRID_STEP;
    const gridEndX = Math.ceil(worldRight / GRID_STEP) * GRID_STEP;
    const gridStartY = Math.floor(worldTop / GRID_STEP) * GRID_STEP;
    const gridEndY = Math.ceil(worldBottom / GRID_STEP) * GRID_STEP;

    for (let x = gridStartX; x <= gridEndX; x += GRID_STEP) {
      context.beginPath();
      context.moveTo(x, worldTop - 1);
      context.lineTo(x, worldBottom + 1);
      context.stroke();
    }

    for (let y = gridStartY; y <= gridEndY; y += GRID_STEP) {
      context.beginPath();
      context.moveTo(worldLeft - 1, y);
      context.lineTo(worldRight + 1, y);
      context.stroke();
    }
  }

  for (const stroke of localCanvas.value.strokes) {
    if (stroke.points.length === 0) continue;

    context.beginPath();
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    stroke.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
  }

  context.restore();
}

function getRelativePoint(event: PointerEvent) {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };

  const viewX = event.clientX - rect.left;
  const viewY = event.clientY - rect.top;
  return {
    x: (viewX - pan.value.x) / zoom.value,
    y: (viewY - pan.value.y) / zoom.value,
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
      left: `${pan.value.x + token.x * zoom.value - token.size / 2}px`,
      top: `${pan.value.y + token.y * zoom.value - token.size / 2}px`,
      width: `${token.size}px`,
      height: `${token.size}px`,
      backgroundColor: token.color,
    },
  })),
);

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
        <div class="zoom-controls">
          <button class="ghost-button zoom-btn" type="button" title="Приблизить" @click="zoomIn">+</button>
          <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
          <button class="ghost-button zoom-btn" type="button" title="Отдалить" @click="zoomOut">−</button>
          <button class="ghost-button zoom-btn" type="button" title="Сбросить вид" @click="resetView">⟲</button>
        </div>
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
      title="Колёсико: zoom • Средняя/ПКМ: перетаскивание (бесконечный холст)"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointerleave="handlePointerUp"
      @wheel.prevent="handleWheel"
      @contextmenu.prevent
    >
      <canvas
        ref="canvasRef"
        class="battle-canvas"
        :width="viewportSize.width"
        :height="viewportSize.height"
      />
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
