# Исправление ошибки "Unknown argument `pathOriginal`"

## Проблема

При попытке создать трек через API появляется ошибка:
```
Unknown argument `pathOriginal`. Available options are marked with ?.
```

## Причина

Схема Prisma не была синхронизирована с базой данных, или Prisma Client не был перегенерирован после изменения схемы.

## Решение

### Шаг 1: Синхронизация схемы с БД

```bash
npm run db:push
```

Это применит все изменения схемы к базе данных.

### Шаг 2: Перегенерация Prisma Client

```bash
npm run db:generate
```

Если появляется ошибка `EPERM: operation not permitted`, это не критично - схема уже применена к БД.

### Шаг 3: Перезапуск dev сервера

**Важно:** После изменения схемы Prisma нужно перезапустить dev сервер:

1. Остановите текущий сервер (Ctrl+C)
2. Запустите снова:
   ```bash
   npm run dev
   ```

Это необходимо, чтобы Next.js подхватил обновленный Prisma Client.

## Проверка

После перезапуска попробуйте снова загрузить трек. Ошибка должна исчезнуть.

## Если проблема сохраняется

1. **Проверьте схему:**
   ```bash
   npm run db:studio
   ```
   Откройте таблицу `Track` и убедитесь, что поля `pathOriginal`, `pathVocals`, `pathDrums`, `pathBass`, `pathOther`, `isProcessed` существуют.

2. **Проверьте миграции:**
   ```bash
   npm run db:migrate
   ```

3. **Очистите кэш:**
   ```bash
   rm -rf node_modules/.prisma
   npm run db:generate
   ```

