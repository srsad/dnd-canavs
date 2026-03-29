<script setup lang="ts">
import { ref } from 'vue';
import type { CanvasImage, CanvasLayer, Participant, RoomCanvas } from '../types';

const props = defineProps<{
  open: boolean;
  position: { x: number; y: number };
  canEdit: boolean;
  syncConnected: boolean;
  canMutateCanvas: boolean;
  canvas: RoomCanvas;
  brushColor: string;
  brushWidth: number;
  activeLayerId: string;
  toolMode: 'draw' | 'fog';
  assignTokenId: string;
  assignParticipantValue: string;
  fogBrushWidth: number;
  zoom: number;
  participants: Participant[];
  activeLayer: CanvasLayer | null;
  selectedCanvasImage: CanvasImage | null;
  imageUploading: boolean;
  imageUploadError: string;
  canUploadCanvasImage: boolean;
}>();

const emit = defineEmits<{
  'update:brushColor': [value: string];
  'update:brushWidth': [value: number];
  'update:activeLayerId': [value: string];
  'update:toolMode': [value: 'draw' | 'fog'];
  'update:assignTokenId': [value: string];
  'update:assignParticipantValue': [value: string];
  'update:fogBrushWidth': [value: number];
  addLayer: [];
  toggleLayerVisibility: [layerId: string];
  zoomIn: [];
  zoomOut: [];
  resetView: [];
  applyTokenControl: [];
  toggleGrid: [];
  toggleFog: [];
  addToken: [];
  clearBoard: [];
  openImageFilePicker: [];
  removeSelectedImage: [];
  selectedImageWidthChange: [value: number];
  selectedImageHeightChange: [value: number];
  selectedImageRotationChange: [value: number];
}>();

const menuRootRef = ref<HTMLDivElement | null>(null);

function menuContainsTarget(target: Node | null): boolean {
  if (!target || !menuRootRef.value) {
    return false;
  }
  return menuRootRef.value.contains(target);
}

function getMenuEl(): HTMLElement | null {
  return menuRootRef.value;
}

defineExpose({ menuContainsTarget, getMenuEl });

function onSelectedImageWidthInput(ev: Event) {
  const n = Number((ev.target as HTMLInputElement).value);
  if (Number.isFinite(n)) {
    emit('selectedImageWidthChange', n);
  }
}

function onSelectedImageHeightInput(ev: Event) {
  const n = Number((ev.target as HTMLInputElement).value);
  if (Number.isFinite(n)) {
    emit('selectedImageHeightChange', n);
  }
}

function onSelectedImageRotationInput(ev: Event) {
  let n = Number((ev.target as HTMLInputElement).value);
  if (!Number.isFinite(n)) {
    return;
  }
  n = ((((n + 180) % 360) + 360) % 360) - 180;
  emit('selectedImageRotationChange', n);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuRootRef"
      class="canvas-context-menu"
      role="dialog"
      aria-label="Меню холста"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @pointerdown.stop
    >
      <p v-if="canEdit && !syncConnected" class="toolbar-offline-hint" role="status">
        Редактирование недоступно без соединения с сервером.
      </p>
      <div v-if="canEdit" class="toolbar-group">
        <label class="field compact">
          <span>Кисть</span>
          <input
            :value="brushColor"
            type="color"
            :disabled="!canMutateCanvas"
            @input="emit('update:brushColor', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="field compact">
          <span>Толщина</span>
          <input
            :value="brushWidth"
            type="range"
            min="2"
            max="12"
            :disabled="!canMutateCanvas"
            @input="emit('update:brushWidth', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </div>

      <div class="toolbar-group canvas-menu-toolbar-flow">
        <template v-if="canEdit">
          <label class="field compact">
            <span>Слой</span>
            <select
              :value="activeLayerId"
              :disabled="!canMutateCanvas"
              @change="emit('update:activeLayerId', ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="layer in canvas.layers" :key="layer.id" :value="layer.id">
                {{ layer.visible ? '👁 ' : '⛔ ' }}{{ layer.name }}
              </option>
            </select>
          </label>
          <button class="ghost-button" type="button" :disabled="!canMutateCanvas" @click="emit('addLayer')">
            + слой
          </button>
          <button
            v-if="activeLayer"
            class="ghost-button"
            type="button"
            :disabled="!canMutateCanvas"
            @click="emit('toggleLayerVisibility', activeLayer.id)"
          >
            {{ activeLayer.visible ? 'Скрыть слой' : 'Показать слой' }}
          </button>

          <div class="segmented">
            <button
              type="button"
              :class="{ active: toolMode === 'draw' }"
              :disabled="!canMutateCanvas"
              @click="emit('update:toolMode', 'draw')"
            >
              Рисование
            </button>
            <button
              type="button"
              :class="{ active: toolMode === 'fog' }"
              :disabled="!canvas.fogEnabled || !canMutateCanvas"
              @click="emit('update:toolMode', 'fog')"
            >
              Туман (стереть)
            </button>
          </div>
        </template>

        <div class="zoom-controls">
          <button class="ghost-button zoom-btn" type="button" title="Приблизить" @click="emit('zoomIn')">
            +
          </button>
          <span class="zoom-value">{{ Math.round(zoom * 100) }}%</span>
          <button class="ghost-button zoom-btn" type="button" title="Отдалить" @click="emit('zoomOut')">
            −
          </button>
          <button class="ghost-button zoom-btn" type="button" title="Сбросить вид" @click="emit('resetView')">
            ⟲
          </button>
        </div>

        <template v-if="canEdit && canvas.tokens.length">
          <div class="toolbar-group token-assign-row">
            <label class="field compact">
              <span>Кому фишка</span>
              <select
                :value="assignTokenId"
                :disabled="!canMutateCanvas"
                @change="emit('update:assignTokenId', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="t in canvas.tokens" :key="t.id" :value="t.id">
                  {{ t.label }}
                </option>
              </select>
            </label>
            <label class="field compact">
              <span>Управление</span>
              <select
                :value="assignParticipantValue"
                :disabled="!canMutateCanvas"
                @change="emit('update:assignParticipantValue', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Только мастер</option>
                <option v-for="p in participants" :key="p.id" :value="p.id">
                  {{ p.displayName }}{{ p.role === 'gm' ? ' (мастер)' : '' }}
                </option>
              </select>
            </label>
            <button class="ghost-button" type="button" :disabled="!canMutateCanvas" @click="emit('applyTokenControl')">
              Назначить
            </button>
          </div>
        </template>

        <template v-if="canEdit">
          <button class="ghost-button" type="button" :disabled="!canMutateCanvas" @click="emit('toggleGrid')">
            {{ canvas.gridEnabled ? 'Скрыть сетку' : 'Показать сетку' }}
          </button>
          <button class="ghost-button" type="button" :disabled="!canMutateCanvas" @click="emit('toggleFog')">
            {{ canvas.fogEnabled ? 'Выключить туман' : 'Включить туман' }}
          </button>
          <label v-if="canvas.fogEnabled" class="field compact">
            <span>Туман</span>
            <input
              :value="fogBrushWidth"
              type="range"
              min="14"
              max="120"
              :disabled="!canMutateCanvas"
              @input="emit('update:fogBrushWidth', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <button class="ghost-button" type="button" :disabled="!canMutateCanvas" @click="emit('addToken')">
            Добавить фишку
          </button>
          <button class="ghost-button" type="button" :disabled="!canMutateCanvas" @click="emit('clearBoard')">
            Очистить линии
          </button>
          <button
            class="ghost-button"
            type="button"
            :disabled="!canMutateCanvas || imageUploading || !canUploadCanvasImage"
            :title="!canUploadCanvasImage ? 'Нужна активная сессия комнаты' : ''"
            @click="emit('openImageFilePicker')"
          >
            {{ imageUploading ? 'Загрузка…' : 'Изображение на холст' }}
          </button>
          <p v-if="imageUploadError" class="image-upload-error" role="alert">{{ imageUploadError }}</p>
        </template>

        <template v-if="canEdit && selectedCanvasImage">
          <div class="toolbar-group image-edit-row">
            <span class="image-edit-label">Картинка</span>
            <label class="field compact">
              <span>Ширина</span>
              <input
                type="number"
                min="8"
                max="8192"
                :value="Math.round(selectedCanvasImage.width)"
                :disabled="!canMutateCanvas"
                @change="onSelectedImageWidthInput"
              />
            </label>
            <label class="field compact">
              <span>Высота</span>
              <input
                type="number"
                min="8"
                max="8192"
                :value="Math.round(selectedCanvasImage.height)"
                :disabled="!canMutateCanvas"
                @change="onSelectedImageHeightInput"
              />
            </label>
            <label class="field compact">
              <span>Поворот °</span>
              <input
                type="number"
                min="-180"
                max="180"
                step="1"
                :value="Math.round(selectedCanvasImage.rotation)"
                :disabled="!canMutateCanvas"
                @change="onSelectedImageRotationInput"
              />
            </label>
            <button class="ghost-button" type="button" :disabled="!canMutateCanvas" @click="emit('removeSelectedImage')">
              Удалить картинку
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.canvas-context-menu {
  position: fixed;
  z-index: 300;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 280px;
  max-width: min(360px, calc(100vw - 16px));
  max-height: 85vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 14px;
  border-radius: 16px;
  background: rgba(30, 41, 59, 0.98);
  border: 1px solid rgba(148, 163, 184, 0.24);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}

.canvas-menu-toolbar-flow {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.canvas-menu-toolbar-flow > .toolbar-group,
.canvas-menu-toolbar-flow > .zoom-controls {
  width: 100%;
}

.canvas-menu-toolbar-flow .segmented {
  width: 100%;
}

.toolbar-offline-hint {
  flex-basis: 100%;
  margin: 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(249, 115, 22, 0.12);
  border-left: 3px solid #f97316;
  font-size: 0.9rem;
  color: #fed7aa;
}

.image-upload-error {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.85rem;
  color: #fca5a5;
}

.image-edit-row {
  align-items: flex-end;
}

.image-edit-label {
  font-size: 0.8rem;
  color: #94a3b8;
  margin-right: 4px;
}
</style>
