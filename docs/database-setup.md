# Настройка базы данных MySQL

Полная инструкция по настройке базы данных для локальной разработки и деплоя на VDS.

## Требования

- MySQL 8.0+ (или MariaDB 10.3+)
- Node.js и npm установлены
- Prisma CLI (устанавливается через `npm install`)

## Локальная разработка

### Вариант 1: Установка MySQL на Windows

1. **Скачайте MySQL Installer:**

   - https://dev.mysql.com/downloads/installer/
   - Выберите "MySQL Installer for Windows" (~400MB)

2. **Установите MySQL:**

   - Выберите **Developer Default**
   - Установите пароль для пользователя `root` (запомните!)
   - Завершите установку

3. **Создайте базу данных:**

   Откройте MySQL Command Line Client или выполните:

   ```bash
   mysql -u root -p
   ```

   Выполните SQL команды:

   ```sql
   CREATE DATABASE IF NOT EXISTS bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER IF NOT EXISTS 'bachata_user'@'localhost' IDENTIFIED BY 'bachata_password';
   GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'localhost';
   FLUSH PRIVILEGES;
   ```

### Вариант 2: Docker (рекомендуется для разработки)

1. **Запустите MySQL контейнер:**

   ```bash
   docker-compose up -d db
   ```

2. **Проверьте статус:**
   ```bash
   docker-compose ps
   ```

## Настройка проекта

### 1. Создайте файл `.env`

```bash
cp .env.example .env
```

### 2. Настройте DATABASE_URL

Отредактируйте `.env`:

**Для локальной MySQL:**

```env
DATABASE_URL="mysql://bachata_user:bachata_password@localhost:3306/bachata_db"
```

**Для Docker:**

```env
DATABASE_URL="mysql://bachata_user:bachata_password@localhost:3306/bachata_db"
```

**Для VDS (замените на ваши данные):**

```env
DATABASE_URL="mysql://username:password@your-vds-ip:3306/bachata_db"
```

### 3. Примените миграции Prisma

```bash
# Генерируем Prisma Client
npm run db:generate

# Применяем схему к БД
npm run db:push
```

### 4. Заполните тестовыми данными (опционально)

```bash
npm run db:seed
```

### 5. Проверьте подключение

```bash
# Откроет Prisma Studio в браузере
npm run db:studio

# Или проверьте через скрипт
npm run db:check
```

## Деплой на VDS (Timeweb или другой)

### Шаг 1: Установка MySQL на VDS

**Для Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install mysql-server -y
sudo mysql_secure_installation
```

**Для CentOS/RHEL:**

```bash
sudo yum install mysql-server -y
sudo systemctl start mysqld
sudo systemctl enable mysqld
sudo mysql_secure_installation
```

### Шаг 2: Настройка MySQL

1. **Подключитесь к MySQL:**

   ```bash
   sudo mysql -u root -p
   ```

2. **Создайте базу данных и пользователя:**

   ```sql
   CREATE DATABASE IF NOT EXISTS bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER IF NOT EXISTS 'bachata_user'@'localhost' IDENTIFIED BY 'strong_password_here';
   GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'localhost';
   FLUSH PRIVILEGES;
   EXIT;
   ```

3. **Настройте удаленный доступ (если нужно):**

   ```sql
   -- Разрешить подключение с любого IP (небезопасно, используйте только для теста)
   CREATE USER 'bachata_user'@'%' IDENTIFIED BY 'strong_password_here';
   GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'%';
   FLUSH PRIVILEGES;

   -- Или разрешить только с конкретного IP
   CREATE USER 'bachata_user'@'your-app-server-ip' IDENTIFIED BY 'strong_password_here';
   GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'your-app-server-ip';
   FLUSH PRIVILEGES;
   ```

4. **Настройте firewall (если используется):**
   ```bash
   # Открыть порт 3306 для MySQL (только если нужен удаленный доступ)
   sudo ufw allow 3306/tcp
   ```

### Шаг 3: Настройка приложения на VDS

1. **Скопируйте проект на сервер**

2. **Создайте `.env` файл:**

   ```env
   DATABASE_URL="mysql://bachata_user:strong_password_here@localhost:3306/bachata_db"
   NODE_ENV=production
   ```

3. **Примените миграции:**

   ```bash
   npm run db:generate
   npm run db:push
   ```

4. **Проверьте подключение:**
   ```bash
   npm run db:check
   ```

## Docker Compose для VDS

Если используете Docker на VDS:

1. **Обновите `docker-compose.yml`:**

   ```yaml
   services:
     db:
       image: mysql:8.0
       environment:
         MYSQL_ROOT_PASSWORD: root_password_here
         MYSQL_DATABASE: bachata_db
         MYSQL_USER: bachata_user
         MYSQL_PASSWORD: strong_password_here
       volumes:
         - mysql_data:/var/lib/mysql
       ports:
         - "3306:3306"
   ```

2. **Запустите контейнеры:**

   ```bash
   docker-compose up -d
   ```

3. **Примените миграции:**
   ```bash
   docker-compose exec app npm run db:push
   ```

## Полезные команды

```bash
# Проверить состояние БД
npm run db:check

# Сканировать папку с музыкой и добавить новые треки
npm run db:scan

# Открыть Prisma Studio (GUI для БД)
npm run db:studio

# Создать миграцию
npm run db:migrate

# Применить схему без миграций (для разработки)
npm run db:push
```

## Резервное копирование

**Создание бэкапа:**

```bash
mysqldump -u bachata_user -p bachata_db > backup_$(date +%Y%m%d).sql
```

**Восстановление:**

```bash
mysql -u bachata_user -p bachata_db < backup_20231225.sql
```

## Решение проблем

### Ошибка подключения

- Проверьте, что MySQL сервис запущен: `sudo systemctl status mysql`
- Проверьте `DATABASE_URL` в `.env`
- Убедитесь, что пользователь имеет права на базу данных
- Проверьте firewall настройки

### Prisma ошибки

- Выполните `npm run db:generate` перед `db:push`
- Убедитесь, что `.env` файл существует и содержит правильный `DATABASE_URL`
- Проверьте версию MySQL (должна быть 8.0+)

### Проблемы с кодировкой

База данных создается с `utf8mb4`, что поддерживает все символы, включая эмодзи. Если возникают проблемы:

```sql
ALTER DATABASE bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## Безопасность

- Используйте сильные пароли для пользователей БД
- Не используйте пользователя `root` для приложения
- Ограничьте доступ к БД только с нужных IP адресов
- Регулярно создавайте резервные копии
- Используйте SSL для подключения к БД на production
