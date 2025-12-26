-- ============================================
-- ПРОСТОЕ РЕШЕНИЕ: Использовать простой пароль
-- ============================================
-- Рекомендуется для локальной разработки
-- ============================================

-- ШАГ 1: Удалить существующего пользователя (если есть)
DROP USER IF EXISTS 'bachata_user'@'localhost';

-- ШАГ 2: Создание базы данных
CREATE DATABASE IF NOT EXISTS bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ШАГ 3: Создание пользователя с ПРОСТЫМ паролем
CREATE USER 'bachata_user'@'localhost' IDENTIFIED BY 'bachata_password';

-- ШАГ 4: Предоставление всех прав пользователю на базу данных
GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'localhost';

-- ШАГ 5: Применение изменений (ОБЯЗАТЕЛЬНО!)
FLUSH PRIVILEGES;

-- ============================================
-- ПРОВЕРКА
-- ============================================

SHOW DATABASES;
SELECT user, host FROM mysql.user WHERE user = 'bachata_user';
SHOW GRANTS FOR 'bachata_user'@'localhost';

