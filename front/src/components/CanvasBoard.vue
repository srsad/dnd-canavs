<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  CanvasImage,
  CanvasLayer,
  Participant,
  RoomCanvas,
  Stroke,
  StrokePoint,
  Token,
} from '../types';
import { uploadRoomCanvasImage } from '../lib/api';
import { randomUUID } from '../lib/randomUUID';
import CanvasBoardContextMenu from './CanvasBoardContextMenu.vue';

const props = withDefaults(
  defineProps<{
    modelValue: RoomCanvas;
    participantId: string;
    canEdit?: boolean;
    /** Move any token without full canvas edit (ACL). */
    canMoveAnyToken?: boolean;
    /** When false, canvas mutations are blocked (e.g. WebSocket disconnected). */
    syncConnected?: boolean;
    participants?: Participant[];
    /** Room slug for S3 presign API (canvas uploads). */
    roomSlug?: string;
    /** Session id from join; sent as X-Room-Session-Id. */
    sessionId?: string;
    /** Optional JWT for registered users (same as other room API calls). */
    authToken?: string | null;
  }>(),
  {
    participants: () => [],
    canMoveAnyToken: false,
    syncConnected: true,
    roomSlug: '',
    sessionId: '',
    authToken: null,
  },
);

const canMutateCanvas = computed(
  () => props.canEdit !== false && props.syncConnected,
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
let activeImageId: string | null = null;
/** World-space: imageCenter - pointer at drag start (keeps grab point under cursor). */
let imageDragOffset = { x: 0, y: 0 };
let activeFogStroke: { id: string; width: number; points: StrokePoint[]; authorId: string } | null =
  null;

const activeLayerId = ref<string>('');
const toolMode = ref<'draw' | 'fog'>('draw');
const assignTokenId = ref('');
const assignParticipantValue = ref('');
const selectedImageId = ref('');
const imageFileInputRef = ref<HTMLInputElement | null>(null);
const imageUploading = ref(false);
const imageUploadError = ref('');

const MAX_IMAGE_DISPLAY_WIDTH = 640;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const canvasImageElementCache = new Map<string, HTMLImageElement>();

function imageUrlIsAppOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function preloadCanvasImageUrls(urls: string[]) {
  for (const url of urls) {
    if (!url) continue;
    const existing = canvasImageElementCache.get(url);
    if (existing?.complete && existing.naturalWidth > 0) continue;
    if (existing) continue;
    const el = new Image();
    // S3/public URLs usually have no CORS for GET; anonymous would block the load.
    // Same-origin (e.g. API proxy) can use anonymous to keep the bitmap origin-clean.
    if (imageUrlIsAppOrigin(url)) {
      el.crossOrigin = 'anonymous';
    }
    el.onload = () => renderCanvas();
    el.onerror = () => renderCanvas();
    canvasImageElementCache.set(url, el);
    el.src = url;
  }
}

function resolveImageLayerId(canvas: RoomCanvas, img: CanvasImage): string {
  const lid = img.layerId;
  if (typeof lid === 'string' && canvas.layers.some((l) => l.id === lid)) {
    return lid;
  }
  return canvas.layers[0]?.id ?? '';
}

function canDragToken(token: Token): boolean {
  if (!props.syncConnected) {
    return false;
  }
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

watch(
  () => (localCanvas.value.canvasImages ?? []).map((i) => i.id).join(','),
  () => {
    if (
      selectedImageId.value &&
      !(localCanvas.value.canvasImages ?? []).some((i) => i.id === selectedImageId.value)
    ) {
      selectedImageId.value = '';
    }
  },
);

watch(
  () => [...new Set((localCanvas.value.canvasImages ?? []).map((i) => i.url))].sort().join('\0'),
  () => {
    preloadCanvasImageUrls([...new Set((localCanvas.value.canvasImages ?? []).map((i) => i.url))]);
    nextTick(() => renderCanvas());
  },
  { immediate: true },
);

const canvasMenuOpen = ref(false);
const menuPosition = ref({ x: 0, y: 0 });
const canvasContextMenuRef = ref<InstanceType<typeof CanvasBoardContextMenu> | null>(null);

const MENU_VIEWPORT_MARGIN = 8;

function clampMenuToViewport(x: number, y: number, width: number, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = vw - width - MENU_VIEWPORT_MARGIN;
  const maxY = vh - height - MENU_VIEWPORT_MARGIN;
  return {
    x: Math.min(
      Math.max(MENU_VIEWPORT_MARGIN, x),
      Math.max(MENU_VIEWPORT_MARGIN, maxX),
    ),
    y: Math.min(
      Math.max(MENU_VIEWPORT_MARGIN, y),
      Math.max(MENU_VIEWPORT_MARGIN, maxY),
    ),
  };
}

async function handleBoardContextMenu(event: MouseEvent) {
  event.preventDefault();
  if (!(event.shiftKey || event.ctrlKey)) {
    return;
  }
  menuPosition.value = { x: event.clientX, y: event.clientY };
  canvasMenuOpen.value = true;
  await nextTick();
  const el = canvasContextMenuRef.value?.getMenuEl?.() ?? null;
  if (el) {
    const r = el.getBoundingClientRect();
    menuPosition.value = clampMenuToViewport(event.clientX, event.clientY, r.width, r.height);
  }
}

function closeCanvasMenu() {
  canvasMenuOpen.value = false;
}

function onDocumentPointerDownCapture(e: PointerEvent) {
  if (!canvasMenuOpen.value) {
    return;
  }
  if (canvasContextMenuRef.value?.menuContainsTarget(e.target as Node)) {
    return;
  }
  closeCanvasMenu();
}

function onDocumentKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && canvasMenuOpen.value) {
    closeCanvasMenu();
  }
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDownCapture, true);
  document.addEventListener('keydown', onDocumentKeyDown);
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
  document.removeEventListener('pointerdown', onDocumentPointerDownCapture, true);
  document.removeEventListener('keydown', onDocumentKeyDown);
  resizeObserver?.disconnect();
  activeStroke = null;
  activeTokenId = null;
  activeImageId = null;
  imageDragOffset = { x: 0, y: 0 };
});

function toggleGrid() {
  if (!canMutateCanvas.value) return;
  updateCanvas({
    ...localCanvas.value,
    gridEnabled: !localCanvas.value.gridEnabled,
  });
}

function clearBoard() {
  if (!canMutateCanvas.value) return;
  const layerId = activeLayerId.value;
  updateCanvas({
    ...localCanvas.value,
    layers: localCanvas.value.layers.map((layer) =>
      layer.id === layerId ? { ...layer, strokes: [] } : layer,
    ),
  });
}

function addToken() {
  if (!canMutateCanvas.value) return;
  const rect = boardRef.value?.getBoundingClientRect();
  const cx = rect ? (rect.width / 2 - pan.value.x) / zoom.value : 120;
  const cy = rect ? (rect.height / 2 - pan.value.y) / zoom.value : 120;

  const newToken: Token = {
    id: randomUUID(),
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
  if (!canMutateCanvas.value) return;
  if (toolMode.value !== 'draw') return;
  if (!activeLayerId.value) return;

  const point = getRelativePoint(event);
  activeStroke = {
    id: randomUUID(),
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
  if (!canMutateCanvas.value) return;
  if (toolMode.value !== 'fog') return;
  if (!localCanvas.value.fogEnabled) return;

  const point = getRelativePoint(event);
  activeFogStroke = {
    id: randomUUID(),
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

function startImageDrag(imageId: string, event: PointerEvent) {
  event.stopPropagation();
  if (!canMutateCanvas.value) {
    return;
  }
  const img = (localCanvas.value.canvasImages ?? []).find((i) => i.id === imageId);
  if (!img) {
    return;
  }
  const p = getRelativePoint(event);
  imageDragOffset = { x: img.x - p.x, y: img.y - p.y };
  selectedImageId.value = imageId;
  activeImageId = imageId;
}

function worldCenterForPlacement() {
  const rect = boardRef.value?.getBoundingClientRect();
  if (!rect) {
    return { x: 200, y: 200 };
  }
  const cx = (rect.width / 2 - pan.value.x) / zoom.value;
  const cy = (rect.height / 2 - pan.value.y) / zoom.value;
  return { x: cx, y: cy };
}

function patchSelectedImage(patch: Partial<CanvasImage>) {
  const id = selectedImageId.value;
  if (!id || !canMutateCanvas.value) {
    return;
  }
  const imgs = localCanvas.value.canvasImages ?? [];
  const next = imgs.map((im) => (im.id === id ? { ...im, ...patch } : im));
  updateCanvas({ ...localCanvas.value, canvasImages: next });
}

function removeSelectedImage() {
  const id = selectedImageId.value;
  if (!id || !canMutateCanvas.value) {
    return;
  }
  updateCanvas({
    ...localCanvas.value,
    canvasImages: (localCanvas.value.canvasImages ?? []).filter((im) => im.id !== id),
  });
  selectedImageId.value = '';
}

function onMenuSelectedImageWidthChange(n: number) {
  if (!Number.isFinite(n)) {
    return;
  }
  patchSelectedImage({ width: Math.min(8192, Math.max(8, Math.round(n))) });
}

function onMenuSelectedImageHeightChange(n: number) {
  if (!Number.isFinite(n)) {
    return;
  }
  patchSelectedImage({ height: Math.min(8192, Math.max(8, Math.round(n))) });
}

function onMenuSelectedImageRotationChange(n: number) {
  if (!Number.isFinite(n)) {
    return;
  }
  patchSelectedImage({ rotation: n });
}

const canUploadCanvasImage = computed(
  () => Boolean(props.roomSlug?.trim() && props.sessionId?.trim()),
);

function openImageFilePicker() {
  if (!canMutateCanvas.value || imageUploading.value) {
    return;
  }
  imageUploadError.value = '';
  imageFileInputRef.value?.click();
}

async function onImageFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }
  if (!props.roomSlug?.trim() || !props.sessionId?.trim()) {
    imageUploadError.value = 'Нет сессии комнаты для загрузки.';
    return;
  }
  if (!canMutateCanvas.value) {
    return;
  }

  const contentType = file.type || 'image/png';
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    imageUploadError.value = 'Допустимы PNG, JPEG, WebP или GIF.';
    return;
  }

  imageUploading.value = true;
  imageUploadError.value = '';

  try {
    const bitmap = await createImageBitmap(file);
    const nw = bitmap.width;
    const nh = bitmap.height;
    bitmap.close();

    const uploaded = await uploadRoomCanvasImage(
      props.roomSlug.trim(),
      props.sessionId.trim(),
      file,
      props.authToken ?? undefined,
    );

    const scale = Math.min(1, MAX_IMAGE_DISPLAY_WIDTH / Math.max(nw, 1));
    const w = Math.max(8, Math.round(nw * scale));
    const h = Math.max(8, Math.round(nh * scale));
    const { x, y } = worldCenterForPlacement();

    const layerId =
      activeLayerId.value.trim() ||
      localCanvas.value.layers[0]?.id ||
      '';

    const newImage: CanvasImage = {
      id: randomUUID(),
      layerId,
      url: uploaded.publicUrl,
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
    };

    updateCanvas({
      ...localCanvas.value,
      canvasImages: [...(localCanvas.value.canvasImages ?? []), newImage],
    });
    selectedImageId.value = newImage.id;
  } catch (err) {
    imageUploadError.value =
      err instanceof Error ? err.message : 'Не удалось загрузить изображение.';
  } finally {
    imageUploading.value = false;
  }
}

function handlePointerDown(event: PointerEvent) {
  if (event.button === 1 || event.button === 2) {
    startPointerDown(event);
  } else if (event.button === 0 && !activeTokenId) {
    if (!canMutateCanvas.value) return;
    selectedImageId.value = '';
    if (toolMode.value === 'fog') startFogErase(event);
    else startDrawing(event);
  }
}

function handlePointerMove(event: PointerEvent) {
  if (handlePanMove(event)) return;
  if (!activeTokenId && !activeImageId && !canMutateCanvas.value) {
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

  if (activeImageId) {
    const point = getRelativePoint(event);
    localCanvas.value = {
      ...localCanvas.value,
      canvasImages: (localCanvas.value.canvasImages ?? []).map((im) =>
        im.id === activeImageId
          ? {
              ...im,
              x: point.x + imageDragOffset.x,
              y: point.y + imageDragOffset.y,
            }
          : im,
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

  if (activeImageId) {
    updateCanvas(localCanvas.value);
    activeImageId = null;
    imageDragOffset = { x: 0, y: 0 };
  }

  finishFogErase();
  finishDrawing();
}

function applyTokenControl() {
  if (!canMutateCanvas.value || !assignTokenId.value) {
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

    const layerImages = (localCanvas.value.canvasImages ?? []).filter(
      (im) => resolveImageLayerId(localCanvas.value, im) === layer.id,
    );
    for (const im of layerImages) {
      const el = canvasImageElementCache.get(im.url);
      if (!el?.complete || !el.naturalWidth) continue;
      context.save();
      context.translate(im.x, im.y);
      context.rotate((im.rotation * Math.PI) / 180);
      try {
        context.drawImage(el, -im.width / 2, -im.height / 2, im.width, im.height);
      } catch {
        /* CORS / decode */
      }
      context.restore();
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
            id: randomUUID(),
            name: 'Base',
            visible: true,
            strokes: legacyStrokes,
          },
        ];

  const baseLayerId = normalizedLayers[0]?.id ?? '';
  const imgs = Array.isArray(value.canvasImages)
    ? value.canvasImages.map((raw) => {
        const img = raw as CanvasImage;
        const ok =
          typeof img.layerId === 'string' && normalizedLayers.some((l) => l.id === img.layerId);
        return {
          ...img,
          layerId: ok ? img.layerId : baseLayerId,
        };
      })
    : [];

  return {
    backgroundColor: value.backgroundColor,
    gridEnabled: value.gridEnabled,
    tokens: value.tokens.map((token) => ({
      ...token,
      controlledByParticipantId: token.controlledByParticipantId,
    })),
    layers: normalizedLayers,
    canvasImages: imgs,
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

const imageOverlayStyles = computed(() => {
  const canvas = localCanvas.value;
  const px = pan.value.x;
  const py = pan.value.y;
  const zf = zoom.value;
  const layerOrder = new Map(canvas.layers.map((l, i) => [l.id, i]));

  const withMeta = (canvas.canvasImages ?? []).map((img, idx) => {
    const layerId = resolveImageLayerId(canvas, img);
    const layerIndex = layerOrder.get(layerId) ?? 0;
    const layer = canvas.layers[layerIndex];
    return { img, idx, layerIndex, layerVisible: layer?.visible !== false };
  });

  return withMeta
    .filter((x) => x.layerVisible)
    .sort((a, b) => a.layerIndex - b.layerIndex || a.idx - b.idx)
    .map(({ img, layerIndex }) => ({
      id: img.id,
      img,
      box: {
        left: `${px + img.x * zf - (img.width * zf) / 2}px`,
        top: `${py + img.y * zf - (img.height * zf) / 2}px`,
        width: `${img.width * zf}px`,
        height: `${img.height * zf}px`,
        transform: `rotate(${img.rotation}deg)`,
        zIndex: 10 + layerIndex,
      },
      selected: selectedImageId.value === img.id,
    }));
});

const selectedCanvasImage = computed(() => {
  const id = selectedImageId.value;
  if (!id) {
    return null;
  }
  return (localCanvas.value.canvasImages ?? []).find((im) => im.id === id) ?? null;
});

const activeLayer = computed(() => {
  const id = activeLayerId.value;
  return localCanvas.value.layers.find((layer) => layer.id === id) ?? localCanvas.value.layers[0];
});

const activeLayerIndex = computed(() =>
  localCanvas.value.layers.findIndex((l) => l.id === activeLayerId.value),
);

/** Вверх = ближе к зрителю (больший индекс в массиве). Слой с индексом 0 не двигается. */
const canMoveLayerUp = computed(() => {
  const i = activeLayerIndex.value;
  const n = localCanvas.value.layers.length;
  return i > 0 && i < n - 1;
});

/** Вниз без обмена с индексом 0 (база всегда снизу). */
const canMoveLayerDown = computed(() => {
  const i = activeLayerIndex.value;
  return i > 1;
});

function moveActiveLayerUp() {
  if (!canMutateCanvas.value) return;
  const layers = localCanvas.value.layers;
  const i = activeLayerIndex.value;
  if (i <= 0 || i >= layers.length - 1) return;
  const next = layers.slice();
  [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
  updateCanvas({ ...localCanvas.value, layers: next });
}

function moveActiveLayerDown() {
  if (!canMutateCanvas.value) return;
  const layers = localCanvas.value.layers;
  const i = activeLayerIndex.value;
  if (i <= 1) return;
  const next = layers.slice();
  [next[i], next[i - 1]] = [next[i - 1]!, next[i]!];
  updateCanvas({ ...localCanvas.value, layers: next });
}

function ensureActiveLayer() {
  if (!Array.isArray(localCanvas.value.layers) || localCanvas.value.layers.length === 0) {
    localCanvas.value = {
      ...localCanvas.value,
      layers: [
        {
          id: randomUUID(),
          name: 'Base',
          visible: true,
          strokes: [],
        },
      ],
      canvasImages: localCanvas.value.canvasImages ?? [],
      fogEnabled: Boolean(localCanvas.value.fogEnabled),
      fogStrokes: localCanvas.value.fogStrokes ?? [],
    };
  }

  if (!activeLayerId.value || !localCanvas.value.layers.some((l) => l.id === activeLayerId.value)) {
    activeLayerId.value = localCanvas.value.layers[0]?.id ?? '';
  }
}

function addLayer() {
  if (!canMutateCanvas.value) return;
  const newLayer: CanvasLayer = {
    id: randomUUID(),
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
  if (!canMutateCanvas.value) return;
  updateCanvas({
    ...localCanvas.value,
    layers: localCanvas.value.layers.map((layer) =>
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
    ),
  });
}

function toggleFog() {
  if (!canMutateCanvas.value) return;
  updateCanvas({
    ...localCanvas.value,
    fogEnabled: !localCanvas.value.fogEnabled,
    fogStrokes: localCanvas.value.fogStrokes ?? [],
  });
}

</script>

<template>
  <section class="panel board-panel">
    <input
      ref="imageFileInputRef"
      class="visually-hidden"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      :disabled="!canMutateCanvas || imageUploading"
      @change="onImageFileChange"
    />

    <CanvasBoardContextMenu
      ref="canvasContextMenuRef"
      :open="canvasMenuOpen"
      :position="menuPosition"
      :can-edit="canEdit !== false"
      :sync-connected="syncConnected"
      :can-mutate-canvas="canMutateCanvas"
      :canvas="localCanvas"
      :brush-color="brushColor"
      :brush-width="brushWidth"
      :active-layer-id="activeLayerId"
      :tool-mode="toolMode"
      :assign-token-id="assignTokenId"
      :assign-participant-value="assignParticipantValue"
      :fog-brush-width="fogBrushWidth"
      :zoom="zoom"
      :participants="participants"
      :active-layer="activeLayer ?? null"
      :can-move-layer-up="canMoveLayerUp"
      :can-move-layer-down="canMoveLayerDown"
      :selected-canvas-image="selectedCanvasImage"
      :image-uploading="imageUploading"
      :image-upload-error="imageUploadError"
      :can-upload-canvas-image="canUploadCanvasImage"
      @update:brush-color="brushColor = $event"
      @update:brush-width="brushWidth = $event"
      @update:active-layer-id="activeLayerId = $event"
      @update:tool-mode="toolMode = $event"
      @update:assign-token-id="assignTokenId = $event"
      @update:assign-participant-value="assignParticipantValue = $event"
      @update:fog-brush-width="fogBrushWidth = $event"
      @add-layer="addLayer"
      @move-layer-up="moveActiveLayerUp"
      @move-layer-down="moveActiveLayerDown"
      @toggle-layer-visibility="toggleLayerVisibility($event)"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @reset-view="resetView"
      @apply-token-control="applyTokenControl"
      @toggle-grid="toggleGrid"
      @toggle-fog="toggleFog"
      @add-token="addToken"
      @clear-board="clearBoard"
      @open-image-file-picker="openImageFilePicker"
      @remove-selected-image="removeSelectedImage"
      @selected-image-width-change="onMenuSelectedImageWidthChange"
      @selected-image-height-change="onMenuSelectedImageHeightChange"
      @selected-image-rotation-change="onMenuSelectedImageRotationChange"
    />

    <div
      ref="boardRef"
      class="board-surface"
      title="Колёсико: масштаб • Средняя кнопка или ПКМ: перетаскивание • Shift+ПКМ или Ctrl+ПКМ: меню холста"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointerleave="handlePointerUp"
      @wheel.prevent="handleWheel"
      @contextmenu="handleBoardContextMenu"
    >
      <canvas
        ref="canvasRef"
        class="battle-canvas"
        :width="viewportSize.width"
        :height="viewportSize.height"
      />
      <div
        v-for="row in imageOverlayStyles"
        :key="row.id"
        class="canvas-image-wrap"
        :class="{ selected: row.selected }"
        :style="row.box"
        role="presentation"
        @pointerdown="startImageDrag(row.id, $event)"
      ></div>
      <button
        v-for="token in tokenStyle"
        :key="token.id"
        class="token-chip"
        :style="token.style"
        type="button"
        :disabled="!canDragToken(token)"
        @pointerdown="startTokenDrag(token.id, $event)"
      >
        {{ token.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.canvas-image-wrap {
  position: absolute;
  box-sizing: border-box;
  transform-origin: center center;
  pointer-events: auto;
  cursor: grab;
}

.canvas-image-wrap.selected {
  outline: 2px solid #a78bfa;
  outline-offset: 2px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.25);
}

.token-chip {
  z-index: 50;
}
</style>
