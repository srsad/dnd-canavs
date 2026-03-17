#!/usr/bin/env sh
# Production start for PaaS (Railway, Render, etc.)
# Запуск в foreground — процесс не завершается
set -e
docker compose up --build
