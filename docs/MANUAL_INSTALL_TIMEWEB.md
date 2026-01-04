# Ручная установка на VDS Timeweb через консоль

Пошаговая инструкция для установки Bachata Beat Counter на уже созданный VDS сервер через веб-консоль Таймвеба.

## 🚀 Быстрая автоматическая установка

Если хотите автоматизировать процесс, используйте скрипт `install-bachata.sh`:

```bash
# Скачайте скрипт
wget https://raw.githubusercontent.com/GSilence/bachata/main/install-bachata.sh -O install-bachata.sh

# Или через curl
curl -o install-bachata.sh https://raw.githubusercontent.com/GSilence/bachata/main/install-bachata.sh

# Сделайте исполняемым и запустите
chmod +x install-bachata.sh
./install-bachata.sh
```

**Особенности скрипта:**

- ✅ Автоматически проверяет, что уже установлено
- ✅ Пропускает выполненные шаги
- ✅ Можно запускать многократно (идемпотентный)
- ✅ Подробное логирование в `/var/log/bachata-install.log`
- ✅ Работает даже если проект еще не загружен

**Или следуйте пошаговой инструкции ниже для ручной установки:**

## Подготовка

1. Откройте панель управления Timeweb
2. Найдите ваш VDS сервер
3. Откройте **Веб-консоль** (VNC/Console) - это встроенный терминал в браузере
4. Войдите как `root` (пароль должен быть указан в панели управления)

## Шаг 1: Обновление системы

```bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
```

## Шаг 2: Установка базовых зависимостей

```bash
apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    ufw \
    nginx \
    certbot \
    python3-certbot-nginx
```

## Шаг 3: Установка Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Проверка установки
node --version
npm --version
```

## Шаг 4: Установка Python 3.10 и системных библиотек

```bash
apt-get install -y \
    python3.10 \
    python3.10-dev \
    python3.10-venv \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    libsndfile1-dev \
    libffi-dev \
    libssl-dev \
    libasound2-dev \
    portaudio19-dev
```

## Шаг 5: Установка MySQL

```bash
apt-get install -y mysql-server
systemctl start mysql
systemctl enable mysql
```

## Шаг 6: Настройка базы данных

```bash
# Генерируем случайный пароль
DB_PASSWORD=$(openssl rand -base64 32)
DB_NAME="bachata_db"
DB_USER="bachata_user"

# Создаем базу данных и пользователя
mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# Сохраняем пароль
echo "DATABASE_URL=mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}" > /root/db_credentials.txt
chmod 600 /root/db_credentials.txt

# Показываем пароль (запишите его!)
echo "=========================================="
echo "Database password: ${DB_PASSWORD}"
echo "Saved to: /root/db_credentials.txt"
echo "=========================================="
```

## Шаг 7: Создание пользователя приложения

```bash
APP_USER="bachata"
APP_DIR="/opt/bachata"

# Создаем пользователя
if ! id -u ${APP_USER} > /dev/null 2>&1; then
    useradd -m -s /bin/bash ${APP_USER}
    usermod -aG sudo ${APP_USER}
    echo "User ${APP_USER} created"
else
    echo "User ${APP_USER} already exists"
fi

# Создаем директорию
mkdir -p ${APP_DIR}
chown ${APP_USER}:${APP_USER} ${APP_DIR}
```

## Шаг 8: Настройка Python виртуального окружения

```bash
# Создаем виртуальное окружение
sudo -u ${APP_USER} python3.10 -m venv ${APP_DIR}/venv

# Обновляем pip
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install --upgrade pip setuptools wheel

# Устанавливаем Cython (нужен для компиляции madmom)
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install Cython>=0.29.0
```

## Шаг 9: Загрузка проекта на сервер

Выберите один из способов:

### Вариант A: Через Git (если проект в репозитории)

```bash
cd ${APP_DIR}
sudo -u ${APP_USER} git clone https://github.com/GSilence/bachata.git .
```

### Вариант B: Через SCP с вашего компьютера

На вашем компьютере выполните:

```bash
scp -r ./* root@your-server-ip:/opt/bachata/
```

Затем на сервере:

```bash
chown -R ${APP_USER}:${APP_USER} ${APP_DIR}
```

### Вариант C: Через SFTP клиент (FileZilla, WinSCP)

1. Подключитесь к серверу через SFTP
2. Загрузите все файлы проекта в `/opt/bachata/`
3. На сервере выполните:

```bash
chown -R ${APP_USER}:${APP_USER} ${APP_DIR}
```

## Шаг 10: Установка Python зависимостей

```bash
cd ${APP_DIR}

# Устанавливаем зависимости из requirements.txt
# Это займет 10-20 минут (особенно компиляция madmom)
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install -r requirements.txt
```

**Важно:** Установка madmom может занять 15-20 минут из-за компиляции. Не прерывайте процесс!

Проверка установки:

```bash
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/python -c "from madmom.features import RNNDownBeatProcessor; print('Madmom OK')"
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/python -c "import demucs; print('Demucs OK')"
```

## Шаг 11: Настройка переменных окружения

```bash
# Получаем пароль БД из сохраненного файла
DB_PASSWORD=$(grep -oP 'mysql://.*:.*@' /root/db_credentials.txt | sed 's/mysql:\/\/.*://' | sed 's/@//')

# Создаем .env.local
cat > ${APP_DIR}/.env.local << EOF
# Database
DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}"

# Python path for Demucs and madmom
DEMUCS_PYTHON_PATH="${APP_DIR}/venv/bin/python"

# Node environment
NODE_ENV=production
EOF

chown ${APP_USER}:${APP_USER} ${APP_DIR}/.env.local
chmod 600 ${APP_DIR}/.env.local
```

## Шаг 12: Создание директорий для загрузок

```bash
mkdir -p ${APP_DIR}/public/uploads/raw
mkdir -p ${APP_DIR}/public/uploads/stems
mkdir -p ${APP_DIR}/public/audio/voice
mkdir -p ${APP_DIR}/public/music
chown -R ${APP_USER}:${APP_USER} ${APP_DIR}/public
```

## Шаг 13: Установка Node.js зависимостей

```bash
cd ${APP_DIR}
sudo -u ${APP_USER} npm install
```

## Шаг 14: Настройка базы данных Prisma

```bash
cd ${APP_DIR}
sudo -u ${APP_USER} npm run db:generate
sudo -u ${APP_USER} npm run db:push
```

## Шаг 15: Сборка Next.js приложения

```bash
cd ${APP_DIR}
sudo -u ${APP_USER} npm run build
```

## Шаг 16: Создание systemd сервиса

```bash
APP_NAME="bachata-beat-counter"

cat > /etc/systemd/system/${APP_NAME}.service << EOF
[Unit]
Description=Bachata Beat Counter Next.js App
After=network.target mysql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment="NODE_ENV=production"
Environment="PORT=3000"
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Загружаем и запускаем сервис
systemctl daemon-reload
systemctl enable ${APP_NAME}
systemctl start ${APP_NAME}
```

## Шаг 17: Настройка Nginx

```bash
# Получаем IP адрес сервера
SERVER_IP=$(hostname -I | awk '{print $1}')

cat > /etc/nginx/sites-available/${APP_NAME} << EOF
server {
    listen 80;
    server_name ${SERVER_IP};

    # Логи
    access_log /var/log/nginx/${APP_NAME}-access.log;
    error_log /var/log/nginx/${APP_NAME}-error.log;

    # Увеличение лимитов для загрузки файлов
    client_max_body_size 100M;
    client_body_timeout 300s;
    client_header_timeout 300s;

    # Проксирование на Next.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # Таймауты для долгих операций (обработка аудио)
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    # Статические файлы
    location /_next/static {
        proxy_pass http://localhost:3000;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, immutable";
    }

    location /public {
        alias ${APP_DIR}/public;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Активируем конфигурацию
ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Проверяем конфигурацию
nginx -t

# Перезагружаем Nginx
systemctl reload nginx
```

## Шаг 18: Настройка firewall

```bash
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
```

## Шаг 19: Создание скрипта управления

```bash
cat > /usr/local/bin/bachata-manage << 'SCRIPT_EOF'
#!/bin/sh
# Скрипт управления Bachata Beat Counter

APP_DIR="/opt/bachata"
APP_USER="bachata"
SERVICE_NAME="bachata-beat-counter"

case "$1" in
    start)
        systemctl start ${SERVICE_NAME}
        echo "Application started"
        ;;
    stop)
        systemctl stop ${SERVICE_NAME}
        echo "Application stopped"
        ;;
    restart)
        systemctl restart ${SERVICE_NAME}
        echo "Application restarted"
        ;;
    status)
        systemctl status ${SERVICE_NAME}
        ;;
    logs)
        journalctl -u ${SERVICE_NAME} -f
        ;;
    update)
        cd ${APP_DIR}
        sudo -u ${APP_USER} git pull || echo "Git pull failed or not a git repo"
        sudo -u ${APP_USER} npm install
        sudo -u ${APP_USER} npm run build
        systemctl restart ${SERVICE_NAME}
        echo "Application updated and restarted"
        ;;
    rebuild)
        cd ${APP_DIR}
        sudo -u ${APP_USER} npm run build
        systemctl restart ${SERVICE_NAME}
        echo "Application rebuilt and restarted"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|update|rebuild}"
        exit 1
        ;;
esac
SCRIPT_EOF

chmod +x /usr/local/bin/bachata-manage
```

## Шаг 20: Загрузка голосовых файлов

Загрузите голосовые файлы в `/opt/bachata/public/audio/voice/`:

- `1.mp3` - для бита 1
- `2.mp3` - для бита 2
- `3.mp3` - для бита 3
- `4.mp3` - для бита 4
- `5.mp3` - для бита 5
- `6.mp3` - для бита 6
- `7.mp3` - для бита 7
- `8.mp3` - для бита 8

**Важно:** Приложение использует только файлы 1-8.mp3 (не 9-10.mp3).

Вы можете загрузить их через SFTP или SCP:

```bash
# С вашего компьютера
scp public/audio/voice/*.mp3 root@your-server-ip:/opt/bachata/public/audio/voice/

# На сервере установите права
chown -R ${APP_USER}:${APP_USER} /opt/bachata/public/audio/voice
```

## Проверка установки

### 1. Проверка сервиса

```bash
bachata-manage status
```

Должен показать `active (running)`

### 2. Проверка логов

```bash
bachata-manage logs
```

Или:

```bash
journalctl -u bachata-beat-counter -f
```

### 3. Проверка базы данных

```bash
# Получаем пароль
cat /root/db_credentials.txt

# Подключаемся к БД
mysql -u bachata_user -p bachata_db
# Введите пароль из /root/db_credentials.txt
```

### 4. Проверка Python окружения

```bash
sudo -u bachata /opt/bachata/venv/bin/python -c "from madmom.features import RNNDownBeatProcessor; print('Madmom OK')"
sudo -u bachata /opt/bachata/venv/bin/python -c "import demucs; print('Demucs OK')"
```

### 5. Проверка доступа к приложению

Откройте в браузере: `http://your-server-ip`

## Настройка домена (опционально)

Если у вас есть домен:

1. Обновите конфигурацию Nginx:

```bash
nano /etc/nginx/sites-available/bachata-beat-counter
```

Замените `server_name ${SERVER_IP};` на `server_name your-domain.com www.your-domain.com;`

2. Перезагрузите Nginx:

```bash
nginx -t
systemctl reload nginx
```

3. Установите SSL сертификат:

```bash
certbot --nginx -d your-domain.com -d www.your-domain.com
```

## Управление приложением

```bash
bachata-manage start    # Запустить
bachata-manage stop     # Остановить
bachata-manage restart  # Перезапустить
bachata-manage status   # Статус
bachata-manage logs     # Логи
bachata-manage rebuild  # Пересобрать и перезапустить
```

## Обновление приложения

### Через Git:

```bash
cd /opt/bachata
sudo -u bachata git pull
sudo -u bachata npm install
sudo -u bachata npm run build
bachata-manage restart
```

### Вручную:

```bash
cd /opt/bachata
sudo -u bachata npm install
sudo -u bachata npm run build
bachata-manage restart
```

## Устранение проблем

### Приложение не запускается

```bash
# Проверьте логи
bachata-manage logs

# Проверьте статус
bachata-manage status

# Проверьте порт
netstat -tlnp | grep 3000
```

### Ошибки базы данных

```bash
# Проверьте подключение
mysql -u bachata_user -p bachata_db

# Проверьте .env.local
cat /opt/bachata/.env.local

# Пересоздайте БД
cd /opt/bachata
sudo -u bachata npm run db:push
```

### Ошибки madmom/demucs

```bash
# Проверьте установку
sudo -u bachata /opt/bachata/venv/bin/python -c "import madmom"
sudo -u bachata /opt/bachata/venv/bin/python -c "import demucs"

# Переустановите при необходимости
sudo -u bachata /opt/bachata/venv/bin/pip install --force-reinstall madmom demucs
```

### Nginx не проксирует

```bash
# Проверьте конфигурацию
nginx -t

# Проверьте логи
tail -f /var/log/nginx/bachata-beat-counter-error.log

# Перезагрузите
systemctl reload nginx
```

## Важные файлы и директории

- **Приложение**: `/opt/bachata`
- **Логи установки**: `/var/log/bachata-install.log` (если использовался скрипт)
- **Пароль БД**: `/root/db_credentials.txt`
- **Конфигурация Nginx**: `/etc/nginx/sites-available/bachata-beat-counter`
- **Systemd сервис**: `/etc/systemd/system/bachata-beat-counter.service`
- **Переменные окружения**: `/opt/bachata/.env.local`

## Резервное копирование

### База данных:

```bash
# Создание бэкапа
mysqldump -u bachata_user -p bachata_db > backup_$(date +%Y%m%d).sql

# Восстановление
mysql -u bachata_user -p bachata_db < backup_20240101.sql
```

### Файлы загрузок:

```bash
tar -czf uploads_backup_$(date +%Y%m%d).tar.gz /opt/bachata/public/uploads/
```

## Готово!

Приложение должно быть доступно по адресу `http://your-server-ip`

Для дальнейшей настройки см.:

- [`docs/DEPLOYMENT_VDS.md`](./DEPLOYMENT_VDS.md) - общая документация по развертыванию
- [`docs/INSTALL_ON_EXISTING_VDS.md`](./INSTALL_ON_EXISTING_VDS.md) - установка через скрипт
