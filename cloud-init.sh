#!/bin/sh
# Cloud-init скрипт для развертывания Bachata Beat Counter на VDS Timeweb
# Использование: Скопируйте ВЕСЬ этот файл целиком в поле "User data" при создании VDS
#
# ВАЖНО: Скрипт полностью автономный!
# - Можно использовать БЕЗ загрузки файлов проекта заранее
# - Скрипт сам определит, загружен ли проект, и выполнит только возможные шаги
# - После загрузки файлов проекта выполните финальные команды (см. логи)

# Обработка ошибок: критичные шаги должны быть успешными
set -e  # Остановка при ошибке для критичных операций

# Логирование
exec > >(tee -a /var/log/cloud-init.log) 2>&1
echo "=== Cloud-init started at $(date) ==="

# Переменные (настройте под себя)
APP_USER="bachata"
APP_DIR="/opt/bachata"
APP_NAME="bachata-beat-counter"
DOMAIN=""  # Оставьте пустым, если домен будет настроен позже (можно использовать IP)
DB_NAME="bachata_db"
DB_USER="bachata_user"
DB_PASSWORD="$(openssl rand -base64 32)"  # Генерируем случайный пароль
NODE_VERSION="20"  # Node.js версия
PYTHON_VERSION="3.10"

# Получаем IP адрес сервера для использования, если домен не указан
SERVER_IP=$(hostname -I | awk '{print $1}')
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "your-domain.com" ]; then
    DOMAIN="$SERVER_IP"
    echo "Domain not specified, using server IP: $DOMAIN"
fi

# Обновление системы
echo "=== Updating system ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y

# Установка базовых зависимостей
echo "=== Installing base dependencies ==="
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

# Установка Node.js через NodeSource
echo "=== Installing Node.js ${NODE_VERSION} ==="
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs

# Установка Python и системных библиотек для madmom
echo "=== Installing Python ${PYTHON_VERSION} and build dependencies ==="
apt-get install -y \
    python${PYTHON_VERSION} \
    python${PYTHON_VERSION}-dev \
    python${PYTHON_VERSION}-venv \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    libsndfile1-dev \
    libffi-dev \
    libssl-dev \
    libasound2-dev \
    portaudio19-dev

# Установка MySQL
echo "=== Installing MySQL ==="
apt-get install -y mysql-server
systemctl start mysql
systemctl enable mysql

# Настройка MySQL
echo "=== Configuring MySQL ==="
mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# Сохраняем пароль БД в файл (для безопасности)
echo "DATABASE_URL=mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}" > /root/db_credentials.txt
chmod 600 /root/db_credentials.txt
echo "Database credentials saved to /root/db_credentials.txt"

# Создание пользователя приложения
echo "=== Creating application user ==="
if ! id -u ${APP_USER} > /dev/null 2>&1; then
    useradd -m -s /bin/bash ${APP_USER}
    usermod -aG sudo ${APP_USER}
fi

# Создание директории приложения
echo "=== Setting up application directory ==="
mkdir -p ${APP_DIR}
chown ${APP_USER}:${APP_USER} ${APP_DIR}

# Клонирование проекта (если используется Git)
# Раскомментируйте и укажите ваш репозиторий:
# echo "=== Cloning repository ==="
# sudo -u ${APP_USER} git clone https://github.com/your-username/${APP_NAME}.git ${APP_DIR}

# ВАЖНО: Если проект уже загружен на сервер вручную, 
# убедитесь, что все файлы находятся в ${APP_DIR}
# и права доступа установлены: chown -R ${APP_USER}:${APP_USER} ${APP_DIR}

# Настройка Python виртуального окружения
echo "=== Setting up Python virtual environment ==="
sudo -u ${APP_USER} python${PYTHON_VERSION} -m venv ${APP_DIR}/venv

# Установка Python зависимостей
echo "=== Installing Python dependencies ==="
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install --upgrade pip setuptools wheel
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install Cython>=0.29.0

# Установка madmom и других зависимостей (может занять 10-20 минут)
echo "=== Installing madmom (this may take 10-20 minutes) ==="
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install -r ${APP_DIR}/requirements.txt

# Проверка установки madmom
echo "=== Verifying madmom installation ==="
sudo -u ${APP_USER} ${APP_DIR}/venv/bin/python -c "from madmom.features import RNNDownBeatProcessor; print('Madmom OK')" || echo "WARNING: Madmom check failed"

# Создание .env.local файла (создаем заранее, даже если проекта еще нет)
echo "=== Creating .env.local ==="
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

# Создание директорий для загрузок
echo "=== Creating upload directories ==="
mkdir -p ${APP_DIR}/public/uploads/raw
mkdir -p ${APP_DIR}/public/uploads/stems
mkdir -p ${APP_DIR}/public/audio/voice
mkdir -p ${APP_DIR}/public/music
chown -R ${APP_USER}:${APP_USER} ${APP_DIR}/public

# Установка Node.js зависимостей (только если проект уже загружен)
set +e  # Временно отключаем остановку при ошибках
if [ -f "${APP_DIR}/package.json" ]; then
    echo "=== Installing Node.js dependencies ==="
    cd ${APP_DIR}
    sudo -u ${APP_USER} npm install || echo "WARNING: npm install failed"
    
    # Генерация Prisma Client
    echo "=== Generating Prisma Client ==="
    sudo -u ${APP_USER} npm run db:generate || echo "WARNING: Prisma generate failed"
    
    # Применение миграций Prisma
    echo "=== Running database migrations ==="
    sudo -u ${APP_USER} npm run db:push || echo "WARNING: Database migrations failed"
    
    # Сборка Next.js приложения
    echo "=== Building Next.js application ==="
    sudo -u ${APP_USER} npm run build || echo "WARNING: Build failed"
else
    echo "=== INFO: package.json not found ==="
    echo "Project files not detected. This is normal if you plan to upload project later."
    echo ""
    echo "After uploading project, run:"
    echo "  cd ${APP_DIR}"
    echo "  sudo -u ${APP_USER} npm install"
    echo "  sudo -u ${APP_USER} npm run db:generate"
    echo "  sudo -u ${APP_USER} npm run db:push"
    echo "  sudo -u ${APP_USER} npm run build"
    echo "  systemctl restart ${APP_NAME}"
fi
set -e  # Включаем обратно

# Создание systemd сервиса
echo "=== Creating systemd service ==="
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

# Загрузка и запуск сервиса (только если проект загружен)
systemctl daemon-reload
systemctl enable ${APP_NAME}
if [ -f "${APP_DIR}/package.json" ]; then
    systemctl start ${APP_NAME}
    echo "Service started"
else
    echo "Service enabled but not started (project not loaded yet)"
    echo "Start it manually after uploading project: systemctl start ${APP_NAME}"
fi

# Настройка Nginx
echo "=== Configuring Nginx ==="
# Если домен не указан (IP адрес), используем только IP
# Проверяем, является ли DOMAIN IP адресом (POSIX-совместимая проверка)
case "$DOMAIN" in
    *[!0-9.]*)
        # Содержит нецифровые символы - это домен
        NGINX_SERVER_NAME="${DOMAIN} www.${DOMAIN}"
        NGINX_SERVER_NAME_LINE="server_name ${DOMAIN} www.${DOMAIN};"
        ;;
    *)
        # Только цифры и точки - проверяем формат IP
        if echo "$DOMAIN" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
            # Это IP адрес, настраиваем без www
            NGINX_SERVER_NAME="${DOMAIN}"
            NGINX_SERVER_NAME_LINE="server_name ${DOMAIN};"
        else
            # Это домен, настраиваем с www
            NGINX_SERVER_NAME="${DOMAIN} www.${DOMAIN}"
            NGINX_SERVER_NAME_LINE="server_name ${DOMAIN} www.${DOMAIN};"
        fi
        ;;
esac

cat > /etc/nginx/sites-available/${APP_NAME} << EOF
server {
    listen 80;
    ${NGINX_SERVER_NAME_LINE}

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

# Активация конфигурации Nginx
ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# Настройка firewall
echo "=== Configuring firewall ==="
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw allow 3306/tcp # MySQL (только для localhost, но на всякий случай)

# Настройка SSL (только если указан домен, не IP)
# Проверяем, является ли DOMAIN IP адресом
IS_IP=$(echo "$DOMAIN" | grep -cE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' || echo "0")
if [ "$IS_IP" = "0" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "your-domain.com" ]; then
    echo "=== Setting up SSL certificate ==="
    echo "To set up SSL later, run:"
    echo "  certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
else
    echo "=== SSL setup skipped (using IP address or domain not configured) ==="
    echo "To set up SSL later when domain is ready, run:"
    echo "  certbot --nginx -d your-domain.com -d www.your-domain.com"
fi

# Создание скрипта для управления приложением
echo "=== Creating management script ==="
cat > /usr/local/bin/bachata-manage << 'SCRIPT_EOF'
#!/bin/bash
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

# Финальная информация
echo "=== Cloud-init completed at $(date) ==="
echo ""
echo "=========================================="
echo "Installation Summary:"
echo "=========================================="
echo "Application directory: ${APP_DIR}"
echo "Application user: ${APP_USER}"
echo "Server IP/Domain: ${DOMAIN}"
echo "Database name: ${DB_NAME}"
echo "Database user: ${DB_USER}"
echo "Database password: Saved in /root/db_credentials.txt"
echo ""
echo "Next steps:"
echo "1. Upload your project files to ${APP_DIR} (via Git, SCP, or SFTP)"
echo "2. Run final setup:"
echo "   cd ${APP_DIR}"
echo "   sudo -u ${APP_USER} npm install"
echo "   sudo -u ${APP_USER} npm run db:generate"
echo "   sudo -u ${APP_USER} npm run db:push"
echo "   sudo -u ${APP_USER} npm run build"
echo "   systemctl restart ${APP_NAME}"
echo "3. Place voice files (1.mp3-8.mp3) in ${APP_DIR}/public/audio/voice/"
echo "   Note: Application uses only files 1-8.mp3 for voice beat counting"
IS_IP_CHECK=$(echo "$DOMAIN" | grep -cE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$' || echo "0")
if [ "$IS_IP_CHECK" != "0" ] || [ -z "$DOMAIN" ] || [ "$DOMAIN" = "your-domain.com" ]; then
    echo "4. (Optional) Update domain in /etc/nginx/sites-available/${APP_NAME}"
    echo "   Then run: certbot --nginx -d your-domain.com -d www.your-domain.com"
else
    echo "4. (Optional) Run 'certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}' for SSL"
fi
echo "5. Check application status: bachata-manage status"
echo "6. View logs: bachata-manage logs"
echo "7. Access application at: http://${DOMAIN}"
echo ""
echo "Management commands:"
echo "  bachata-manage start    - Start application"
echo "  bachata-manage stop     - Stop application"
echo "  bachata-manage restart  - Restart application"
echo "  bachata-manage status   - Check status"
echo "  bachata-manage logs     - View logs"
echo "  bachata-manage rebuild  - Rebuild and restart"
echo "=========================================="

