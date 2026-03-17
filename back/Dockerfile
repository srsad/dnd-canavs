# ========== Stage 1: Build ==========
FROM node:22-alpine AS builder

WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем все зависимости (включая dev для сборки)
RUN npm ci

# Генерируем Prisma Client
RUN npx prisma generate

# Копируем исходный код
COPY . .

# Собираем приложение
RUN npm run build

# ========== Stage 2: Production ==========
FROM node:22-alpine AS runner

WORKDIR /app

# Создаём непривилегированного пользователя
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# Копируем только необходимое из builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# Права на файлы
RUN chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

# Применяем схему БД и запускаем приложение
# Используйте prisma migrate deploy вместо db push, если есть миграции
CMD ["sh", "-c", "npx prisma db push && node dist/main.js"]
