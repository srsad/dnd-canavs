# DnD Canvas

MVP-проект для настольных RPG и других игр с общим холстом. Пользователь создаёт комнату,
делится ссылкой, а участники подключаются как через зарегистрированный аккаунт, так и как
гости по имени.

## Что уже реализовано

- `backend` на `NestJS`
- `frontend` на `Vue 3 + Vite + Pinia + Vue Router`
- регистрация и вход по `JWT`
- гостевое подключение по имени
- создание комнат и переход по ссылке
- realtime-синхронизация участников и холста через `socket.io`
- простая battle map: рисование, сетка, фишки

## Структура

- `back` - API, авторизация, комнаты, websocket gateway, хранение данных в PostgreSQL через Prisma
- `front` - клиентское приложение с лобби, подключением к комнате и холстом

## Запуск

### Вариант 1: Docker (backend + PostgreSQL)

Для запуска бэкенда и БД в контейнерах:

```bash
cd back
docker compose up -d
```

API будет доступен на `http://localhost:3000`, PostgreSQL — на `localhost:5432`.

Опционально создайте `back/.env` и задайте `JWT_SECRET`, `FRONTEND_URL` (по умолчанию `http://localhost:5173`).

### Вариант 2: Production (Docker — frontend + backend + БД)

Полный стек для деплоя:

```bash
# В корне проекта
cp .env.example .env
# Отредактируйте .env: JWT_SECRET, FRONTEND_URL (публичный URL)

docker compose up -d
# или npm start — для PaaS (foreground)
```

Приложение будет на `http://localhost` (порт 80, задаётся через `PORT` в `.env`). Nginx раздаёт статику фронтенда и проксирует API и WebSocket на бэкенд.

**Деплой на PaaS** (Railway, Render и т.п.): см. [DEPLOY.md](DEPLOY.md) — команды сборки/запуска, переменные окружения.

### Вариант 3: Локальный запуск (разработка)

1. Установить зависимости:

```bash
cd back && npm install
cd ../front && npm install
```

2. Создать env-файлы по примерам:

- `back/.env.example`
- `front/.env.example`

3. Запустить PostgreSQL (локально или через Docker: `cd back && docker compose up -d db`).

4. Запустить backend:

```bash
npm --prefix back run start:dev
```

5. Запустить frontend:

```bash
npm --prefix front run dev
```

## Основные сценарии

### Зарегистрированный пользователь

1. На главной странице создаёт аккаунт или входит.
2. Создаёт комнату или открывает ссылку комнаты.
3. На странице комнаты видит свои данные и нажимает кнопку подключения.
4. После подключения получает доступ к общему холсту.

### Незарегистрированный пользователь

1. Переходит по ссылке комнаты.
2. Вводит своё имя.
3. Нажимает кнопку подключения.
4. После подключения видит общий холст и остальных участников.

## Backend API

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /rooms`
- `GET /rooms/:slug`
- `GET /rooms/:slug/canvas-history`
- `POST /rooms/:slug/join`

WebSocket namespace:

- `/rooms`

События:

- client → `canvas:replace` (только GM), `tokens:move` (GM или игрок по своим фишкам), `chat:send`, `dice:roll`, `presence:ui`
- server → `room_state`, `presence_updated`, `canvas_updated`, `chat:message`, `dice_log_added`

## Ограничения MVP

- сессии комнаты живут в памяти сервера (переподключение — новая сессия через `join`)
- нет отдельной ACL кроме ролей `gm` / `player` и назначения фишек
- нет экспорта/импорта комнат и долгосрочного аудита действий

## Следующие шаги

- **Роли и фишки:** мастер правит холстом (`canvas:replace`); игроки двигают только фишки, назначенные им полем `controlledByParticipantId` (WebSocket `tokens:move`). Дальше — опционально «своя фишка», сетка привязки, undo.
- **Слои, туман, чат:** в структуре `RoomCanvas` и в `CanvasBoard` есть слои и туман; чат — `chat:send` / `chat:message`, UI — `ChatPanel`.
- **История холста:** до 50 снимков в `canvasHistory` при полной замене холста мастером; `GET /rooms/:slug/canvas-history`, просмотр и откат — `CanvasHistoryPanel` (мастер может «Применить выбранный»).

Идеи на потом: постоянное хранение сессий, роли вне владельца комнаты, общий чат с упоминаниями, запись сессии.
