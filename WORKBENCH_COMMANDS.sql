-- ============================================
-- КОМАНДЫ ДЛЯ ВЫПОЛНЕНИЯ В MYSQL WORKBENCH
-- ============================================
-- 
-- ИНСТРУКЦИЯ:
-- 1. Откройте MySQL Workbench
-- 2. Подключитесь к серверу (root@localhost)
-- 3. Откройте новый SQL редактор (Ctrl+T или File → New Query Tab)
-- 4. Скопируйте ВСЕ команды ниже и вставьте в редактор
-- 5. Нажмите ⚡ Execute (или Ctrl+Enter)
-- 6. Проверьте результат в панели Output внизу
--
-- ============================================

-- ШАГ 1: Создание базы данных
CREATE DATABASE IF NOT EXISTS bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ШАГ 2: Создание пользователя (если еще не создан)
-- ВАЖНО: Если у вас уже есть пользователь bachata_user с другим паролем,
-- сначала удалите его: DROP USER IF EXISTS 'bachata_user'@'localhost';
CREATE USER IF NOT EXISTS 'bachata_user'@'localhost' IDENTIFIED BY 'bachata_password';

-- ШАГ 3: Предоставление всех прав пользователю на базу данных
GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'localhost';

-- ШАГ 4: Применение изменений (ОБЯЗАТЕЛЬНО!)
FLUSH PRIVILEGES;

-- ============================================
-- ПРОВЕРКА (выполните после основных команд)
-- ============================================

-- Показать все базы данных (должна быть bachata_db)
SHOW DATABASES;

-- Показать пользователя (должен быть bachata_user)
SELECT user, host FROM mysql.user WHERE user = 'bachata_user';

-- Показать права пользователя
SHOW GRANTS FOR 'bachata_user'@'localhost';

