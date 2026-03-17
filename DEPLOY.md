# Деплой через Docker Compose

Инструкция для платформ (Railway, Render, Coolify, CapRover и т.п.), которые запускают приложения через docker-compose.

## Команды для настройки

### Команда сборки (Build Command)
```bash
docker compose build
```
Или, если платформа поддерживает единую команду:
```bash
npm run docker:build
```

### Команда запуска (Start / Run Command)
```bash
docker compose up --build
```
Важно: **без `-d`** — процесс должен работать в foreground, чтобы платформа могла отслеживать состояние.

Альтернатива:
```bash
npm start
```

### Порты

- Web-сервис: **front** (порт 80)
- Платформа должна проксировать внешний трафик на порт 80 контейнера `front`
- Если платформа задаёт `PORT` (например 8080), задайте его в переменных окружения — в `docker-compose.yml` используется `${PORT:-80}`

## Переменные окружения

Обязательные:

| Переменная      | Описание                    |
|-----------------|-----------------------------|
| `JWT_SECRET`    | Секрет для JWT (обязательно) |
| `FRONTEND_URL`  | Публичный URL приложения (например `https://your-app.com`) |

Опционально:

| Переменная         | По умолчанию |
|--------------------|--------------|
| `PORT`             | 80           |
| `POSTGRES_USER`    | user         |
| `POSTGRES_PASSWORD`| password     |
| `POSTGRES_DB`      | dnd_canvas   |

## Пример для Railway

В настройках сервиса:

- **Build Command**: `docker compose build`
- **Start Command**: `docker compose up`
- **Root Directory**: `/` (корень репозитория)
- Variables: `JWT_SECRET`, `FRONTEND_URL`

## Пример для Render

В `render.yaml` (если используется):

```yaml
services:
  - type: web
    name: dnd-canvas
    env: docker
    dockerfilePath: ./docker-compose.yml
    dockerContext: .
    buildCommand: docker compose build
    startCommand: docker compose up
    envVars:
      - key: JWT_SECRET
        sync: false
      - key: FRONTEND_URL
        sync: false
```

## Возможные проблемы

1. **Процесс завершается сразу** — убедитесь, что команда запуска `docker compose up` **без** `-d`
2. **Не находит docker-compose** — на некоторых платформах используется `docker-compose` (с дефисом)
3. **База данных** — для persistent storage нужна поддержка volumes. На Railway/Render база обычно управляется отдельно — тогда используйте `back/docker-compose.yml` (только backend+db) и деплойте frontend отдельно
