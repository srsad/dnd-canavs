# Архитектура фронтенда D&D Canvas

## Обзор

Фронтенд — SPA на **Vue 3** с **TypeScript**, **Pinia** и **Vue Router**. Используются **Vite** для сборки и **Socket.IO Client** для синхронизации данных в реальном времени.

## Структура проекта

```
front/
├── src/
│   ├── components/       # Переиспользуемые UI-компоненты
│   ├── views/            # Страницы (маршруты)
│   ├── stores/           # Pinia stores (состояние приложения)
│   ├── router/           # Vue Router
│   ├── lib/              # Утилиты и клиенты API/WebSocket
│   ├── types/            # Общие TypeScript-типы
│   ├── App.vue
│   ├── main.ts
│   └── style.css
├── vite.config.ts
└── package.json
```

## Стек технологий

| Платформа | Технология |
|-----------|------------|
| UI | Vue 3 (Composition API) |
| Маршрутизация | Vue Router 5 |
| Состояние | Pinia 3 |
| Сборка | Vite 8 |
| Язык | TypeScript |
| Real-time | Socket.IO Client |

## Слои приложения

### 1. Точка входа (`main.ts`)

- Создание Vue-приложения, Pinia и Router
- Hydration сессии из `localStorage` (токен и пользователь)
- Фоновая проверка `/auth/me` при наличии токена
- Монтирование приложения

### 2. Роутинг (`router/index.ts`)

| Маршрут | Компонент | Описание |
|---------|-----------|----------|
| `/` | `HomeView` | Главная: создание комнат и вход по ссылке |
| `/room/:slug` | `RoomView` | Страница комнаты с холстом и участниками |

### 3. Управление состоянием (Pinia stores)

#### auth store (`stores/auth.ts`)

Отвечает за аутентификацию:

- **Состояние:** `accessToken`, `user`, `loading`, `error`
- **Поведение:** регистрация, логин, логаут, проверка сессии (`fetchMe`)
- **Персистентность:** токен и `user` сохраняются в `localStorage` (`dnd-canvas-auth`)
- **Hydration:** восстановление сессии при загрузке страницы

#### room store (`stores/room.ts`)

Отвечает за комнаты и real-time синхронизацию:

- **Состояние:** `room`, `participants`, `currentParticipant`, `sessionId`, `socket`, `loading`, `syncing`, `error`
- **REST API:** `fetchRoom`, `createRoom`, `joinRoom`
- **WebSocket:** `connectRealtime`, `disconnectRealtime`, обработка `room_state`, `presence_updated`, `canvas_updated`
- **Синхронизация холста:** `replaceCanvas` (emit `canvas:replace`)

### 4. Слой данных (`lib/`)

#### api.ts

- `apiRequest<T>(path, options)` — REST-клиент с JWT и обработкой ошибок
- `getApiUrl()` — базовый URL API
- URL задаётся через `VITE_API_URL` или `/api` в dev

#### socket.ts

- `createRoomSocket(roomSlug, sessionId)` — создание Socket.IO-клиента для комнаты
- Namespace `/rooms`, auth: `roomSlug`, `sessionId`
- URL через `VITE_WS_URL` или текущий хост в dev

### 5. Типы (`types/index.ts`)

Общие типы для домена:

- `User`, `AuthResponse` — аутентификация
- `Participant` — участник комнаты (`registered` / `guest`)
- `Stroke`, `StrokePoint`, `Token` — холст
- `RoomCanvas`, `Room` — комната и её холст
- `JoinRoomResponse`, `RoomSummaryResponse` — ответы API

### 6. Views (страницы)

#### HomeView

- Создание комнаты (`CreateRoomPanel` + `roomStore.createRoom`)
- Открытие комнаты по ссылке/коду
- `AuthPanel` для регистрации/логина
- Редирект на `/room/:slug` после создания

#### RoomView

- Просмотр комнаты по slug
- Подключение к комнате: гостевой вход или авторизованный пользователь
- После подключения — холст и панель участников
- `watch` на slug: загрузка комнаты, восстановление или новое подключение
- Копирование ссылки на комнату
- WebSocket подключается после `joinRoom`

### 7. Компоненты (`components/`)
Проект старается переиспользовать компоненты и стили, чтобы не повторяться.

| Компонент | Назначение |
|-----------|------------|
| `AuthPanel` | Регистрация/логин, отображение текущего пользователя |
| `CreateRoomPanel` | Форма создания комнаты (название, имя гостя при guest-flow) |
| `ParticipantsPanel` | Список участников комнаты |
| `CanvasBoard` | Интерактивный холст: рисование, токены, сетка |

#### CanvasBoard

- **Props:** `modelValue: RoomCanvas`, `participantId: string`
- **Emits:** `update:modelValue` (v-model)
- Локальное копирование холста для быстрого отрисовки
- Синхронизация с родителем через `emit` при завершении действий
- Функции: рисование, перетаскивание токенов, сетка, очистка, добавление токенов
- Canvas 2D для рендеринга, HTML overlay для токенов

## Потоки данных

### Создание комнаты

1. Пользователь заполняет форму в `CreateRoomPanel`
2. `HomeView` вызывает `roomStore.createRoom()`
3. REST POST `/rooms` → `room`, `participant`, `sessionId`
4. Router.push на `/room/:slug`
5. В `RoomView` уже есть сессия → `connectRealtime()` и показ холста

### Подключение к комнате

1. Пользователь переходит на `/room/:slug` (например, по ссылке)
2. `RoomView` вызывает `roomStore.fetchRoom(slug)` → данные комнаты без сессии
3. Пользователь вводит имя (гость) или подключается как авторизованный
4. `roomStore.joinRoom()` → REST POST `/rooms/:slug/join`
5. `connectRealtime()` → WebSocket подключается
6. События `room_state`, `presence_updated`, `canvas_updated` обновляют store

### Синхронизация холста

1. Пользователь рисует или двигает токен в `CanvasBoard`
2. `emit('update:modelValue', canvas)` → `RoomView` вызывает `roomStore.replaceCanvas()`
3. Store делает `socket.emit('canvas:replace', { canvas })`
4. Бэкенд рассылает `canvas_updated` всем участникам
5. В store обновляется `room.canvas` через обработчик события

## Vite и проксирование

```typescript
// vite.config.ts
proxy: {
  '/api'    → backend :3000 (REST)
  '/socket.io' → backend :3000 (WebSocket)
}
```

В dev-режиме запросы к `/api` и `/socket.io` проксируются на backend.

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `VITE_API_URL` | Базовый URL REST API |
| `VITE_WS_URL` | URL для Socket.IO |

По умолчанию в dev: `/api` и текущий хост; в prod — `http://localhost:3000`.
