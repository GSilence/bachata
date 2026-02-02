-- Пересоздание пользователя bachata_user (если пропал или забыт пароль)
-- Запуск: mysql -u root -p < scripts/recreate-db-user.sql
-- Или в консоли MySQL: source D:/Sites/bachata/scripts/recreate-db-user.sql

CREATE DATABASE IF NOT EXISTS bachata_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP USER IF EXISTS 'bachata_user'@'localhost';
CREATE USER 'bachata_user'@'localhost' IDENTIFIED BY 'bachata_password';

GRANT ALL PRIVILEGES ON bachata_db.* TO 'bachata_user'@'localhost';
FLUSH PRIVILEGES;

SELECT user, host FROM mysql.user WHERE user = 'bachata_user';
SHOW DATABASES LIKE 'bachata_db';
