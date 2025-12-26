# Инструкция по развертыванию

## Требования
- Docker и Docker Compose
- MySQL (или использование Docker Compose для БД)

## Локальная разработка

1. Установить зависимости:
```bash
npm install
```

2. Настроить переменные окружения:
```bash
cp .env.example .env
# Отредактировать .env, указать DATABASE_URL
```

3. Запустить миграции Prisma:
```bash
npm run db:generate
npm run db:push
```

4. Запустить dev сервер:
```bash
npm run dev
```

## Docker деплой

### Сборка образа
```bash
docker build -t bachata-beat-counter .
```

### Запуск контейнера
```bash
docker-compose up -d
```

### Миграции в контейнере
```bash
docker-compose exec app npm run db:push
```

## Production настройки

- Установить переменные окружения на сервере
- Настроить reverse proxy (nginx) для Next.js
- Настроить SSL сертификаты
- Настроить резервное копирование БД

