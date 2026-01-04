# Быстрое развертывание на VDS Timeweb

## Что делает cloud-init скрипт

Скрипт `cloud-init.sh` автоматически:

✅ Устанавливает все системные зависимости (Node.js, Python, FFmpeg, MySQL, build tools)  
✅ Настраивает Python виртуальное окружение и устанавливает madmom, demucs, librosa  
✅ Настраивает MySQL базу данных  
✅ Создает systemd сервис для автозапуска  
✅ Настраивает Nginx как reverse proxy  
✅ Настраивает firewall  
✅ Создает скрипт управления `bachata-manage`

## Варианты установки

### Вариант A: Cloud-init (при создании нового VDS)

Используйте `cloud-init.sh` - он выполнится автоматически при первом запуске сервера.

### Вариант B: Ручная установка (на уже созданный VDS)

Если VDS уже создан, используйте `install-on-existing-vds.sh` - см. [`docs/INSTALL_ON_EXISTING_VDS.md`](./docs/INSTALL_ON_EXISTING_VDS.md)

---

## Cloud-init установка (новый VDS)

### Шаг 1: Подготовка скрипта

1. Откройте файл `cloud-init.sh`
2. **Домен опционален!** Можно оставить пустым:

   ```bash
   DOMAIN=""  # Оставьте пустым - будет использован IP адрес сервера
   ```

   Или укажите домен (если уже есть):

   ```bash
   DOMAIN="your-domain.com"  # Укажите ваш домен
   ```

   **Примечание:** Если домен не указан, скрипт автоматически использует IP адрес сервера. Домен можно добавить позже.

### Шаг 2: Создание VDS в Timeweb

1. Зайдите в панель Timeweb
2. Создайте новый VDS:
   - **ОС**: Ubuntu 22.04 LTS или Ubuntu 24.04 LTS
   - **RAM**: минимум 4GB (рекомендуется 8GB для компиляции madmom)
   - **CPU**: минимум 2 ядра
   - **Диск**: минимум 50GB
3. В разделе **"User data"** или **"Cloud-init"** вставьте **весь** содержимое файла `cloud-init.sh`
4. Создайте VDS

### Шаг 3: Ожидание установки

Установка займет **15-30 минут** (особенно компиляция madmom).

Проверить прогресс можно через SSH:

```bash
ssh root@your-server-ip
tail -f /var/log/cloud-init.log
```

### Шаг 4: Загрузка проекта на сервер

После завершения установки загрузите проект одним из способов:

#### Вариант A: Через Git (рекомендуется)

```bash
ssh root@your-server-ip
cd /opt/bachata
sudo -u bachata git clone https://github.com/GSilence/bachata.git .
```

#### Вариант B: Через SCP

```bash
# С вашего компьютера
scp -r ./* root@your-server-ip:/opt/bachata/
ssh root@your-server-ip "chown -R bachata:bachata /opt/bachata"
```

### Шаг 5: Финальная настройка

```bash
ssh root@your-server-ip

# Установка зависимостей
cd /opt/bachata
sudo -u bachata npm install

# Генерация Prisma Client
sudo -u bachata npm run db:generate

# Применение миграций
sudo -u bachata npm run db:push

# Сборка приложения
sudo -u bachata npm run build

# Перезапуск сервиса
systemctl restart bachata-beat-counter
```

### Шаг 6: Настройка домена и SSL (опционально)

Если домен не был указан при установке, можно добавить его позже:

```bash
# Обновите домен в конфигурации Nginx
nano /etc/nginx/sites-available/bachata-beat-counter
# Замените IP адрес на ваш домен в строке server_name

# Перезагрузите Nginx
nginx -t
systemctl reload nginx

# Установите SSL
certbot --nginx -d your-domain.com -d www.your-domain.com
```

**Примечание:** Если домен не настроен, приложение будет доступно по IP адресу сервера.

## Управление приложением

```bash
# Статус
bachata-manage status

# Логи
bachata-manage logs

# Перезапуск
bachata-manage restart

# Пересборка после изменений
bachata-manage rebuild
```

## Важные файлы и директории

- **Приложение**: `/opt/bachata`
- **Логи приложения**: `journalctl -u bachata-beat-counter -f`
- **Логи Nginx**: `/var/log/nginx/bachata-beat-counter-error.log`
- **Пароль БД**: `/root/db_credentials.txt`
- **Конфигурация Nginx**: `/etc/nginx/sites-available/bachata-beat-counter`
- **Systemd сервис**: `/etc/systemd/system/bachata-beat-counter.service`

## Проверка установки

```bash
# Проверка сервиса
systemctl status bachata-beat-counter

# Проверка madmom
sudo -u bachata /opt/bachata/venv/bin/python -c "from madmom.features import RNNDownBeatProcessor; print('Madmom OK')"

# Проверка базы данных
mysql -u bachata_user -p bachata_db
# Пароль в /root/db_credentials.txt

# Проверка порта
netstat -tlnp | grep 3000
```

## Что установлено

- **Node.js** 20.x
- **Python** 3.10 с venv
- **MySQL** 8.0
- **FFmpeg** (для обработки аудио)
- **Nginx** (reverse proxy)
- **Python библиотеки**: madmom, demucs, librosa, soundfile, numpy, scipy
- **Build tools**: gcc, g++, make (для компиляции madmom)

## Требования к серверу

- **Минимум**: 4GB RAM, 2 CPU, 50GB диск
- **Рекомендуется**: 8GB RAM, 4 CPU, 100GB диск (для компиляции madmom и обработки файлов)

## Устранение проблем

См. подробную документацию: [`docs/DEPLOYMENT_VDS.md`](./docs/DEPLOYMENT_VDS.md)
