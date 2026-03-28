<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  CanvasLayer,
  Participant,
  RoomCanvas,
  Stroke,
  StrokePoint,
  Token,
} from '../types';

const props = withDefaults(
  defineProps<{
    modelValue: RoomCanvas;
    participantId: string;
    canEdit?: boolean;
    /** Move any token without full canvas edit (ACL). */
    canMoveAnyToken?: boolean;
    participants?: Participant[];
  }>(),
  { participants: () => [], canMoveAnyToken: false },
);

const emit = defineEmits<{
  'update:modelValue': [value: RoomCanvas];
  commitTokenMoves: [moves: Array<{ id: string; x: number; y: number }>];
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
const fogBrushWidth = ref(46);

const pan = ref({ x: 0, y: 0 });
const zoom = ref(1);

let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
let isPanning = false;
let activeStroke: Stroke | null = null;
let activeTokenId: string | null = null;
let activeFogStroke: { id: string; width: number; points: StrokePoint[]; authorId: string } | null =
  null;

const activeLayerId = ref<string>('');
const toolMode = ref<'draw' | 'fog'>('draw');
const assignTokenId = ref('');
const assignParticipantValue = ref('');

function canDragToken(token: Token): boolean {
  if (props.canEdit || props.canMoveAnyToken) {
    return true;
  }
  return token.controlledByParticipantId === props.participantId;
}

watch(
  () => props.modelValue,
  async (value) => {
    localCanvas.value = cloneCanvas(value);
    ensureActiveLayer();
    await nextTick();
    renderCanvas();
  },
  { deep: true, immediate: true },
);

watch([brushColor, brushWidth, viewportSize, pan, zoom], () => {
  renderCanvas();
});

watch(
  () => localCanvas.value.tokens.map((t) => t.id),
  (ids) => {
    if (!ids.length) {
      assignTokenId.value = '';
      return;
    }
    if (!assignTokenId.value || !ids.includes(assignTokenId.value)) {
      assignTokenId.value = ids[0] ?? '';
    }
  },
  { immediate: true },
);

watch(assignTokenId, (tid) => {
  if (!tid) {
    assignParticipantValue.value = '';
    return;
  }
  const t = localCanvas.value.tokens.find((x) => x.id === tid);
  assignParticipantValue.value = t?.controlledByParticipantId ?? '';
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
  ensureActiveLayer();
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
  const layerId = activeLayerId.value;
  updateCanvas({
    ...localCanvas.value,
    layers: localCanvas.value.layers.map((layer) =>
      layer.id === layerId ? { ...layer, strokes: [] } : layer,
    ),
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
  if (toolMode.value !== 'draw') return;
  if (!activeLayerId.value) return;

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

  const stroke = activeStroke;
  const strokeId = stroke.id;
  stroke.points.push(getRelativePoint(event));

  const layerId = activeLayerId.value;
  localCanvas.value = {
    ...localCanvas.value,
    layers: localCanvas.value.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      return {
        ...layer,
        strokes: [
          ...layer.strokes.filter((stroke) => stroke.id !== strokeId),
          stroke,
        ],
      };
    }),
  };

  renderCanvas();
}

function finishDrawing() {
  if (!activeStroke) {
    return;
  }

  const stroke = activeStroke;
  const strokeId = stroke.id;
  const layerId = activeLayerId.value;
  updateCanvas({
    ...localCanvas.value,
    layers: localCanvas.value.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      return {
        ...layer,
        strokes: [
          ...layer.strokes.filter((stroke) => stroke.id !== strokeId),
          stroke,
        ],
      };
    }),
  });

  activeStroke = null;
}

function startFogErase(event: PointerEvent) {
  if (activeTokenId || isPanning) return;
  if (props.canEdit === false) return;
  if (toolMode.value !== 'fog') return;
  if (!localCanvas.value.fogEnabled) return;

  const point = getRelativePoint(event);
  activeFogStroke = {
    id: crypto.randomUUID(),
    width: fogBrushWidth.value,
    authorId: props.participantId,
    points: [point],
  };
}

function eraseFog(event: PointerEvent) {
  if (!activeFogStroke) return;
  activeFogStroke.points.push(getRelativePoint(event));

  localCanvas.value = {
    ...localCanvas.value,
    fogStrokes: [
      ...(localCanvas.value.fogStrokes ?? []).filter((stroke) => stroke.id !== activeFogStroke?.id),
      activeFogStroke,
    ],
  };

  renderCanvas();
}

function finishFogErase() {
  if (!activeFogStroke) return;

  updateCanvas({
    ...localCanvas.value,
    fogStrokes: [
      ...(localCanvas.value.fogStrokes ?? []).filter((stroke) => stroke.id !== activeFogStroke?.id),
      activeFogStroke,
    ],
  });

  activeFogStroke = null;
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
  const token = localCanvas.value.tokens.find((t) => t.id === tokenId);
  if (!token || !canDragToken(token)) {
    return;
  }
  activeTokenId = tokenId;
}

function handlePointerDown(event: PointerEvent) {
  if (event.button === 1 || event.button === 2) {
    startPointerDown(event);
  } else if (event.button === 0 && !activeTokenId) {
    if (props.canEdit === false) return;
    if (toolMode.value === 'fog') startFogErase(event);
    else startDrawing(event);
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

  if (toolMode.value === 'fog') eraseFog(event);
  else draw(event);
}

function finishInteraction() {
  if (activeTokenId) {
    const id = activeTokenId;
    const token = localCanvas.value.tokens.find((t) => t.id === id);
    if (token && props.canEdit === false) {
      emit('commitTokenMoves', [{ id, x: token.x, y: token.y }]);
    } else {
      updateCanvas(localCanvas.value);
    }
    activeTokenId = null;
  }

  finishFogErase();
  finishDrawing();
}

function applyTokenControl() {
  if (props.canEdit === false || !assignTokenId.value) {
    return;
  }
  const pid = assignParticipantValue.value.trim();
  updateCanvas({
    ...localCanvas.value,
    tokens: localCanvas.value.tokens.map((t) =>
      t.id === assignTokenId.value
        ? {
            ...t,
            controlledByParticipantId: pid || undefined,
          }
        : t,
    ),
  });
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

  for (const layer of localCanvas.value.layers) {
    if (!layer.visible) continue;

    for (const stroke of layer.strokes) {
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
  }

  if (localCanvas.value.fogEnabled) {
    context.save();
    context.fillStyle = 'rgba(15, 23, 42, 0.62)';
    context.fillRect(
      worldLeft - 1,
      worldTop - 1,
      worldRight - worldLeft + 2,
      worldBottom - worldTop + 2,
    );

    const fogStrokes = localCanvas.value.fogStrokes ?? [];
    if (fogStrokes.length > 0) {
      context.globalCompositeOperation = 'destination-out';
      context.strokeStyle = '#000';
      context.lineCap = 'round';
      context.lineJoin = 'round';

      for (const stroke of fogStrokes) {
        if (stroke.points.length === 0) continue;
        context.beginPath();
        context.lineWidth = stroke.width;
        stroke.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();
      }
    }

    context.restore();
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
  const layers: CanvasLayer[] = Array.isArray((value as unknown as { layers?: unknown }).layers)
    ? (value.layers ?? []).map((layer) => ({
        ...layer,
        strokes: layer.strokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((point) => ({ ...point })),
        })),
      }))
    : [];

  const legacyStrokes = Array.isArray((value as unknown as { strokes?: unknown }).strokes)
    ? (((value as unknown as { strokes?: Stroke[] }).strokes as Stroke[]) ?? []).map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      }))
    : [];

  const normalizedLayers =
    layers.length > 0
      ? layers
      : [
          {
            id: crypto.randomUUID(),
            name: 'Base',
            visible: true,
            strokes: legacyStrokes,
          },
        ];

  return {
    backgroundColor: value.backgroundColor,
    gridEnabled: value.gridEnabled,
    tokens: value.tokens.map((token) => ({
      ...token,
      controlledByParticipantId: token.controlledByParticipantId,
    })),
    layers: normalizedLayers,
    fogEnabled: Boolean(value.fogEnabled),
    fogStrokes: Array.isArray(value.fogStrokes)
      ? value.fogStrokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((point) => ({ ...point })),
        }))
      : [],
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

const activeLayer = computed(() => {
  const id = activeLayerId.value;
  return localCanvas.value.layers.find((layer) => layer.id === id) ?? localCanvas.value.layers[0];
});

function ensureActiveLayer() {
  if (!Array.isArray(localCanvas.value.layers) || localCanvas.value.layers.length === 0) {
    localCanvas.value = {
      ...localCanvas.value,
      layers: [
        {
          id: crypto.randomUUID(),
          name: 'Base',
          visible: true,
          strokes: [],
        },
      ],
      fogEnabled: Boolean(localCanvas.value.fogEnabled),
      fogStrokes: localCanvas.value.fogStrokes ?? [],
    };
  }

  if (!activeLayerId.value || !localCanvas.value.layers.some((l) => l.id === activeLayerId.value)) {
    activeLayerId.value = localCanvas.value.layers[0]?.id ?? '';
  }
}

function addLayer() {
  if (props.canEdit === false) return;
  const newLayer: CanvasLayer = {
    id: crypto.randomUUID(),
    name: `Layer ${localCanvas.value.layers.length + 1}`,
    visible: true,
    strokes: [],
  };
  updateCanvas({
    ...localCanvas.value,
    layers: [...localCanvas.value.layers, newLayer],
  });
  activeLayerId.value = newLayer.id;
}

function toggleLayerVisibility(layerId: string) {
  if (props.canEdit === false) return;
  updateCanvas({
    ...localCanvas.value,
    layers: localCanvas.value.layers.map((layer) =>
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
    ),
  });
}

function toggleFog() {
  if (props.canEdit === false) return;
  updateCanvas({
    ...localCanvas.value,
    fogEnabled: !localCanvas.value.fogEnabled,
    fogStrokes: localCanvas.value.fogStrokes ?? [],
  });
}

</script>

<template>
  <section class="panel board-panel">
    <div class="board-toolbar">
      <div v-if="canEdit !== false" class="toolbar-group">
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
        <template v-if="canEdit !== false">
          <label class="field compact">
            <span>Слой</span>
            <select v-model="activeLayerId">
              <option v-for="layer in localCanvas.layers" :key="layer.id" :value="layer.id">
                {{ layer.visible ? '👁 ' : '⛔ ' }}{{ layer.name }}
              </option>
            </select>
          </label>
          <button class="ghost-button" type="button" @click="addLayer">+ слой</button>
          <button
            v-if="activeLayer"
            class="ghost-button"
            type="button"
            @click="toggleLayerVisibility(activeLayer.id)"
          >
            {{ activeLayer.visible ? 'Скрыть слой' : 'Показать слой' }}
          </button>

          <div class="segmented">
            <button type="button" :class="{ active: toolMode === 'draw' }" @click="toolMode = 'draw'">
              Рисование
            </button>
            <button
              type="button"
              :class="{ active: toolMode === 'fog' }"
              :disabled="!localCanvas.fogEnabled"
              @click="toolMode = 'fog'"
            >
              Туман (стереть)
            </button>
          </div>
        </template>

        <div class="zoom-controls">
          <button class="ghost-button zoom-btn" type="button" title="Приблизить" @click="zoomIn">+</button>
          <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
          <button class="ghost-button zoom-btn" type="button" title="Отдалить" @click="zoomOut">−</button>
          <button class="ghost-button zoom-btn" type="button" title="Сбросить вид" @click="resetView">⟲</button>
        </div>

        <template v-if="canEdit !== false && localCanvas.tokens.length">
          <div class="toolbar-group token-assign-row">
            <label class="field compact">
              <span>Кому фишка</span>
              <select v-model="assignTokenId">
                <option v-for="t in localCanvas.tokens" :key="t.id" :value="t.id">
                  {{ t.label }}
                </option>
              </select>
            </label>
            <label class="field compact">
              <span>Управление</span>
              <select v-model="assignParticipantValue">
                <option value="">Только мастер</option>
                <option v-for="p in participants" :key="p.id" :value="p.id">
                  {{ p.displayName }}{{ p.role === 'gm' ? ' (мастер)' : '' }}
                </option>
              </select>
            </label>
            <button class="ghost-button" type="button" @click="applyTokenControl">
              Назначить
            </button>
          </div>
        </template>

        <template v-if="canEdit !== false">
          <button class="ghost-button" type="button" @click="toggleGrid">
            {{ localCanvas.gridEnabled ? 'Скрыть сетку' : 'Показать сетку' }}
          </button>
          <button class="ghost-button" type="button" @click="toggleFog">
            {{ localCanvas.fogEnabled ? 'Выключить туман' : 'Включить туман' }}
          </button>
          <label v-if="localCanvas.fogEnabled" class="field compact">
            <span>Туман</span>
            <input v-model.number="fogBrushWidth" type="range" min="14" max="120" />
          </label>
          <button class="ghost-button" type="button" @click="addToken">Добавить фишку</button>
          <button class="ghost-button" type="button" @click="clearBoard">Очистить линии</button>
        </template>
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
