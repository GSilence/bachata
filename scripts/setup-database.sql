-- Скрипт для создания базы данных и пользователя
-- Выполните этот скрипт от имени пользователя root после установки MySQL

-- Создание базы данных
CREATE DATABASE IF NOT EXISTS bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Создание пользователя (если не существует)
CREATE USER IF NOT EXISTS 'bachata_user'@'localhost' IDENTIFIED BY 'bachata_password';

-- Предоставление прав пользователю
GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'localhost';

-- Применение изменений
FLUSH PRIVILEGES;

-- Показать созданную базу данных
SHOW DATABASES LIKE 'bachata_db';

