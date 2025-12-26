-- ============================================
-- КОМАНДЫ С ПРАВИЛЬНЫМ ЭКРАНИРОВАНИЕМ ПАРОЛЯ
-- ============================================
-- Используйте этот файл, если хотите использовать сложный пароль
-- с специальными символами
--
-- ============================================

-- ШАГ 1: Создание базы данных
CREATE DATABASE IF NOT EXISTS bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ШАГ 2: Создание пользователя с экранированным паролем
-- Если пользователь уже существует, сначала удалите его:
-- DROP USER IF EXISTS 'bachata_user'@'localhost';

-- ВАРИАНТ A: Если пароль содержит обратные кавычки и слеши
-- Замените 'ВАШ_ПАРОЛЬ' на ваш пароль, удваивая обратные слеши:
-- Например, если пароль: p7gHN`l`g%S=2WiTun\
-- То в SQL должно быть: p7gHN``l``g%S=2WiTun\\
CREATE USER IF NOT EXISTS 'bachata_user'@'localhost' IDENTIFIED BY 'p7gHN``l``g%S=2WiTun\\';

-- ВАРИАНТ B: Использовать двойные кавычки (работает не всегда)
-- CREATE USER IF NOT EXISTS 'bachata_user'@'localhost' IDENTIFIED BY "p7gHN`l`g%S=2WiTun\\";

-- ШАГ 3: Предоставление всех прав пользователю на базу данных
GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'localhost';

-- ШАГ 4: Применение изменений (ОБЯЗАТЕЛЬНО!)
FLUSH PRIVILEGES;

-- ============================================
-- ПРОВЕРКА
-- ============================================

SHOW DATABASES;
SELECT user, host FROM mysql.user WHERE user = 'bachata_user';
SHOW GRANTS FOR 'bachata_user'@'localhost';

