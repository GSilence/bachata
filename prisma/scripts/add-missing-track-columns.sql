-- Добавить недостающие колонки в Track (безопасно: уже существующие вызовут ошибку, --force пропустит)
-- Запуск: mysql -u USER -p bachata_db --force < prisma/scripts/add-missing-track-columns.sql

ALTER TABLE `track` ADD COLUMN `fileHash` VARCHAR(191) NULL;
ALTER TABLE `track` ADD COLUMN `genreHint` VARCHAR(191) NULL;
ALTER TABLE `track` ADD COLUMN `hasAccents` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `track` ADD COLUMN `hasBridges` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `track` ADD COLUMN `hasMambo` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `track` ADD COLUMN `metaAlbum` VARCHAR(500) NULL;
ALTER TABLE `track` ADD COLUMN `metaArtist` VARCHAR(500) NULL;
ALTER TABLE `track` ADD COLUMN `metaComment` TEXT NULL;
ALTER TABLE `track` ADD COLUMN `metaGenre` VARCHAR(200) NULL;
ALTER TABLE `track` ADD COLUMN `metaTitle` VARCHAR(500) NULL;
ALTER TABLE `track` ADD COLUMN `metaTrackNum` INTEGER NULL;
ALTER TABLE `track` ADD COLUMN `metaYear` INTEGER NULL;
ALTER TABLE `track` ADD COLUMN `rowDominancePercent` DOUBLE NULL;
ALTER TABLE `track` ADD COLUMN `rowSwapped` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `track` ADD COLUMN `trackStatus` VARCHAR(191) NOT NULL DEFAULT 'unlistened';
