# История изменений схемы БД

## 2024 - Начальная схема (MVP)

### Track
- `id` (Int, PK, autoincrement)
- `title` (String) - название трека
- `artist` (String?, nullable) - исполнитель
- `filename` (String) - путь к файлу
- `bpm` (Int) - ударов в минуту
- `offset` (Float) - смещение первого бита в секундах
- `isFree` (Boolean, default: true) - бесплатный ли трек
- `createdAt` (DateTime, default: now())

### User (задел на будущее)
- `id` (Int, PK, autoincrement)
- `email` (String, unique)
- `password` (String)
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

