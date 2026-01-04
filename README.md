# Bachata Beat Counter

Веб-приложение для танцоров бачаты, которое проигрывает музыку и накладывает поверх неё голосовой счет (ритм).

## Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка базы данных

См. подробную инструкцию: [`docs/database-setup.md`](./docs/database-setup.md)

### 3. Настройка переменных окружения

Создайте файл `.env.local` в корне проекта:

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/bachata_db"

# Demucs (если установлен в venv)
DEMUCS_PYTHON_PATH=D:\Sites\bachata\venv\Scripts\python.exe
```

### 4. Инициализация базы данных

```bash
npm run db:generate
npm run db:push
```

### 5. Запуск проекта

```bash
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000) в браузере.

## Установка Demucs (для обработки аудио)

См. инструкции:
- [`docs/INSTALL_PYTHON_FFMPEG.md`](./docs/INSTALL_PYTHON_FFMPEG.md) - установка Python и FFmpeg
- [`docs/DEMUCS_SETUP.md`](./docs/DEMUCS_SETUP.md) - установка Demucs

**Важно:** Demucs требует Python 3.8+ и FFmpeg.

## Проверка установки

```bash
# Проверка базы данных
npm run db:check

# Проверка Demucs
npm run check:demucs
```

## Структура проекта

- `/app` - Next.js App Router страницы и API routes
- `/components` - React компоненты
- `/lib` - утилиты (audioEngine, prisma, demucs)
- `/store` - Zustand store для состояния
- `/prisma` - схема базы данных
- `/docs` - документация проекта
- `/public/music` - аудио файлы
- `/public/audio/voice` - голосовые сэмплы для счета

## Развертывание на VDS

### Быстрая установка через консоль

```bash
# Скачайте и запустите автоматический скрипт установки
wget https://raw.githubusercontent.com/your-repo/bachata/main/install-bachata.sh -O install-bachata.sh
chmod +x install-bachata.sh
./install-bachata.sh
```

**Особенности:**
- ✅ Автоматически проверяет, что уже установлено
- ✅ Пропускает выполненные шаги
- ✅ Можно запускать многократно

Подробнее: [`docs/QUICK_START.md`](./docs/QUICK_START.md)

## Документация

- [`docs/QUICK_START.md`](./docs/QUICK_START.md) - быстрая установка на VDS
- [`docs/MANUAL_INSTALL_TIMEWEB.md`](./docs/MANUAL_INSTALL_TIMEWEB.md) - пошаговая ручная установка
- [`docs/DEPLOYMENT_VDS.md`](./docs/DEPLOYMENT_VDS.md) - полная документация по развертыванию
- [`docs/database-setup.md`](./docs/database-setup.md) - настройка базы данных
- [`docs/DEMUCS_SETUP.md`](./docs/DEMUCS_SETUP.md) - установка Demucs
- [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) - решение проблем

## Технологии

- **Next.js 15** (App Router)
- **React 18**
- **TypeScript**
- **Tailwind CSS**
- **Howler.js** - аудио движок
- **Zustand** - управление состоянием
- **Prisma** - ORM для MySQL
- **Demucs** - разделение аудио на стемы
