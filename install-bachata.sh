#!/bin/bash
# Автоматическая установка Bachata Beat Counter на VDS Timeweb
# Использование:
#   wget https://raw.githubusercontent.com/GSilence/bachata/master/install-bachata.sh -O install-bachata.sh
#   chmod +x install-bachata.sh
#   ./install-bachata.sh
#
# Или через curl:
#   curl -o install-bachata.sh https://raw.githubusercontent.com/GSilence/bachata/master/install-bachata.sh
#   chmod +x install-bachata.sh
#   ./install-bachata.sh

set -e  # Остановка при критичных ошибках

# Логирование
LOG_FILE="/var/log/bachata-install.log"
exec > >(tee -a ${LOG_FILE}) 2>&1
echo "=== Installation started at $(date) ==="

# Переменные
APP_USER="bachata"
APP_DIR="/opt/bachata"
APP_NAME="bachata-beat-counter"
DOMAIN=""  # Будет определен автоматически как IP
DB_NAME="bachata_db"
DB_USER="bachata_user"
NODE_VERSION="20"
PYTHON_VERSION="3.10"

# Получаем IP адрес сервера
SERVER_IP=$(hostname -I | awk '{print $1}')
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "your-domain.com" ]; then
    DOMAIN="$SERVER_IP"
    echo "Using server IP: $DOMAIN"
fi

# Функции для проверок
check_command() {
    command -v "$1" >/dev/null 2>&1
}

check_file() {
    [ -f "$1" ]
}

check_dir() {
    [ -d "$1" ]
}

check_service() {
    systemctl is-active --quiet "$1" 2>/dev/null
}

check_user() {
    id -u "$1" >/dev/null 2>&1
}

# Функция для безопасного выполнения (с проверкой)
safe_exec() {
    local step_name="$1"
    local check_func="$2"
    local exec_func="$3"
    
    echo ""
    echo "=== Checking: $step_name ==="
    
    if $check_func; then
        echo "✓ $step_name already completed, skipping..."
        return 0
    else
        echo "→ Executing: $step_name"
        $exec_func
        if $check_func; then
            echo "✓ $step_name completed successfully"
            return 0
        else
            echo "✗ $step_name failed"
            return 1
        fi
    fi
}

# Шаг 1: Обновление системы
step_update_system() {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get upgrade -y -qq
}

check_system_updated() {
    # Простая проверка - если apt-get работает, система обновлена
    apt-get -qq update >/dev/null 2>&1
}

# Шаг 2: Установка базовых зависимостей
step_install_base_deps() {
    apt-get install -y -qq \
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
        python3-certbot-nginx >/dev/null 2>&1
}

check_base_deps() {
    check_command curl && \
    check_command wget && \
    check_command git && \
    check_command nginx
}

# Шаг 3: Установка Node.js
step_install_nodejs() {
    if ! check_command node; then
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - >/dev/null 2>&1
        apt-get install -y -qq nodejs >/dev/null 2>&1
    fi
}

check_nodejs() {
    check_command node && \
    node --version | grep -q "v${NODE_VERSION}" && \
    check_command npm
}

# Шаг 4: Установка Python и библиотек
step_install_python() {
    apt-get install -y -qq \
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
        portaudio19-dev >/dev/null 2>&1
}

check_python() {
    check_command python${PYTHON_VERSION} && \
    check_command ffmpeg
}

# Шаг 5: Установка MySQL
step_install_mysql() {
    apt-get install -y -qq mysql-server >/dev/null 2>&1
    systemctl start mysql >/dev/null 2>&1
    systemctl enable mysql >/dev/null 2>&1
}

check_mysql() {
    check_command mysql && \
    check_service mysql
}

# Шаг 6: Настройка базы данных
step_setup_database() {
    # Генерируем пароль, если его еще нет
    if [ ! -f /root/db_credentials.txt ]; then
        DB_PASSWORD=$(openssl rand -base64 32)
        echo "DATABASE_URL=mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}" > /root/db_credentials.txt
        chmod 600 /root/db_credentials.txt
        
        mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
        mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';" 2>/dev/null
        mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';" 2>/dev/null
        mysql -e "FLUSH PRIVILEGES;" 2>/dev/null
        
        echo "Database password: ${DB_PASSWORD}"
        echo "Password saved to: /root/db_credentials.txt"
    else
        # Извлекаем пароль из существующего файла
        DB_PASSWORD=$(grep -oP 'mysql://.*:.*@' /root/db_credentials.txt | sed 's/mysql:\/\/.*://' | sed 's/@//' || openssl rand -base64 32)
        
        # Проверяем и создаем БД, если нужно
        mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
        mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';" 2>/dev/null
        mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';" 2>/dev/null
        mysql -e "FLUSH PRIVILEGES;" 2>/dev/null
    fi
}

check_database() {
    check_file /root/db_credentials.txt && \
    mysql -u ${DB_USER} -e "USE ${DB_NAME};" 2>/dev/null
}

# Шаг 7: Создание пользователя приложения
step_create_app_user() {
    if ! check_user ${APP_USER}; then
        useradd -m -s /bin/bash ${APP_USER}
        usermod -aG sudo ${APP_USER} 2>/dev/null || true
    fi
    mkdir -p ${APP_DIR}
    chown ${APP_USER}:${APP_USER} ${APP_DIR}
}

check_app_user() {
    check_user ${APP_USER} && \
    check_dir ${APP_DIR}
}

# Шаг 8: Настройка Python виртуального окружения
step_setup_python_venv() {
    if [ ! -d "${APP_DIR}/venv" ]; then
        sudo -u ${APP_USER} python${PYTHON_VERSION} -m venv ${APP_DIR}/venv
    fi
    sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install --upgrade pip setuptools wheel -q
    sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install Cython>=0.29.0 -q
}

check_python_venv() {
    check_dir ${APP_DIR}/venv && \
    check_file ${APP_DIR}/venv/bin/python
}

# Шаг 9: Установка Python зависимостей (только если проект загружен)
step_install_python_deps() {
    if [ -f "${APP_DIR}/requirements.txt" ]; then
        echo "Installing Python dependencies (this may take 10-20 minutes)..."
        sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install -r ${APP_DIR}/requirements.txt -q
    else
        echo "⚠ requirements.txt not found, skipping Python dependencies installation"
        echo "   Install them manually after uploading project:"
        echo "   sudo -u ${APP_USER} ${APP_DIR}/venv/bin/pip install -r ${APP_DIR}/requirements.txt"
        return 0
    fi
}

check_python_deps() {
    if [ ! -f "${APP_DIR}/requirements.txt" ]; then
        return 0  # Пропускаем, если проекта еще нет
    fi
    sudo -u ${APP_USER} ${APP_DIR}/venv/bin/python -c "from madmom.features import RNNDownBeatProcessor" 2>/dev/null && \
    sudo -u ${APP_USER} ${APP_DIR}/venv/bin/python -c "import demucs" 2>/dev/null
}

# Шаг 10: Создание .env.local
step_create_env_file() {
    if [ ! -f "${APP_DIR}/.env.local" ]; then
        DB_PASSWORD=$(grep -oP 'mysql://.*:.*@' /root/db_credentials.txt | sed 's/mysql:\/\/.*://' | sed 's/@//' || openssl rand -base64 32)
        
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
    fi
}

check_env_file() {
    check_file ${APP_DIR}/.env.local
}

# Шаг 11: Создание директорий
step_create_directories() {
    mkdir -p ${APP_DIR}/public/uploads/raw
    mkdir -p ${APP_DIR}/public/uploads/stems
    mkdir -p ${APP_DIR}/public/audio/voice
    mkdir -p ${APP_DIR}/public/music
    chown -R ${APP_USER}:${APP_USER} ${APP_DIR}/public
}

check_directories() {
    check_dir ${APP_DIR}/public/uploads/raw && \
    check_dir ${APP_DIR}/public/audio/voice
}

# Шаг 12: Установка Node.js зависимостей (только если проект загружен)
step_install_node_deps() {
    if [ -f "${APP_DIR}/package.json" ]; then
        cd ${APP_DIR}
        sudo -u ${APP_USER} npm install --silent
    else
        echo "⚠ package.json not found, skipping Node.js dependencies installation"
        return 0
    fi
}

check_node_deps() {
    if [ ! -f "${APP_DIR}/package.json" ]; then
        return 0  # Пропускаем, если проекта еще нет
    fi
    check_dir ${APP_DIR}/node_modules
}

# Шаг 13: Настройка Prisma (только если проект загружен)
step_setup_prisma() {
    if [ -f "${APP_DIR}/package.json" ] && [ -f "${APP_DIR}/prisma/schema.prisma" ]; then
        cd ${APP_DIR}
        sudo -u ${APP_USER} npm run db:generate 2>&1 | grep -v "warning" || true
        sudo -u ${APP_USER} npm run db:push 2>&1 | grep -v "warning" || true
    else
        echo "⚠ Prisma schema not found, skipping database setup"
        return 0
    fi
}

check_prisma() {
    if [ ! -f "${APP_DIR}/prisma/schema.prisma" ]; then
        return 0  # Пропускаем, если проекта еще нет
    fi
    check_dir ${APP_DIR}/node_modules/.prisma
}

# Шаг 14: Сборка Next.js (только если проект загружен)
step_build_app() {
    if [ -f "${APP_DIR}/package.json" ]; then
        cd ${APP_DIR}
        echo "Building Next.js application (this may take a few minutes)..."
        sudo -u ${APP_USER} npm run build 2>&1 | tail -20
    else
        echo "⚠ package.json not found, skipping build"
        return 0
    fi
}

check_build() {
    if [ ! -f "${APP_DIR}/package.json" ]; then
        return 0  # Пропускаем, если проекта еще нет
    fi
    check_dir ${APP_DIR}/.next
}

# Шаг 15: Создание systemd сервиса
step_create_systemd_service() {
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
    systemctl daemon-reload
    systemctl enable ${APP_NAME} >/dev/null 2>&1
}

check_systemd_service() {
    check_file /etc/systemd/system/${APP_NAME}.service && \
    systemctl is-enabled ${APP_NAME} >/dev/null 2>&1
}

# Шаг 16: Настройка Nginx
step_setup_nginx() {
    cat > /etc/nginx/sites-available/${APP_NAME} << EOF
server {
    listen 80;
    server_name ${DOMAIN};

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
    ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t >/dev/null 2>&1
    systemctl reload nginx >/dev/null 2>&1
}

check_nginx() {
    check_file /etc/nginx/sites-available/${APP_NAME} && \
    nginx -t >/dev/null 2>&1
}

# Шаг 17: Настройка firewall
step_setup_firewall() {
    ufw --force enable >/dev/null 2>&1
    ufw allow 22/tcp >/dev/null 2>&1
    ufw allow 80/tcp >/dev/null 2>&1
    ufw allow 443/tcp >/dev/null 2>&1
}

check_firewall() {
    ufw status | grep -q "Status: active"
}

# Шаг 18: Создание скрипта управления
step_create_manage_script() {
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
}

check_manage_script() {
    check_file /usr/local/bin/bachata-manage && \
    [ -x /usr/local/bin/bachata-manage ]
}

# Шаг 19: Запуск сервиса (только если проект загружен и собран)
step_start_service() {
    if [ -f "${APP_DIR}/package.json" ] && [ -d "${APP_DIR}/.next" ]; then
        systemctl start ${APP_NAME} >/dev/null 2>&1 || true
        sleep 2
        if check_service ${APP_NAME}; then
            echo "✓ Service started successfully"
        else
            echo "⚠ Service may not be running. Check logs: bachata-manage logs"
        fi
    else
        echo "⚠ Project not loaded or not built yet. Start service manually after setup:"
        echo "   systemctl start ${APP_NAME}"
    fi
}

# Выполнение всех шагов
echo "=========================================="
echo "Bachata Beat Counter - Automated Install"
echo "=========================================="
echo ""

# Основные шаги установки
safe_exec "System update" check_system_updated step_update_system
safe_exec "Base dependencies" check_base_deps step_install_base_deps
safe_exec "Node.js ${NODE_VERSION}" check_nodejs step_install_nodejs
safe_exec "Python ${PYTHON_VERSION}" check_python step_install_python
safe_exec "MySQL" check_mysql step_install_mysql
safe_exec "Database setup" check_database step_setup_database
safe_exec "Application user" check_app_user step_create_app_user
safe_exec "Python virtual environment" check_python_venv step_setup_python_venv
safe_exec "Python dependencies" check_python_deps step_install_python_deps
safe_exec "Environment file" check_env_file step_create_env_file
safe_exec "Directories" check_directories step_create_directories
safe_exec "Node.js dependencies" check_node_deps step_install_node_deps
safe_exec "Prisma setup" check_prisma step_setup_prisma
safe_exec "Next.js build" check_build step_build_app
safe_exec "Systemd service" check_systemd_service step_create_systemd_service
safe_exec "Nginx configuration" check_nginx step_setup_nginx
safe_exec "Firewall" check_firewall step_setup_firewall
safe_exec "Management script" check_manage_script step_create_manage_script

# Запуск сервиса (без проверки, так как может быть не готов)
echo ""
echo "=== Starting service ==="
step_start_service

# Финальная информация
echo ""
echo "=========================================="
echo "Installation Summary"
echo "=========================================="
echo "Application directory: ${APP_DIR}"
echo "Application user: ${APP_USER}"
echo "Server IP/Domain: ${DOMAIN}"
echo "Database name: ${DB_NAME}"
echo "Database user: ${DB_USER}"
if [ -f /root/db_credentials.txt ]; then
    echo "Database password: Saved in /root/db_credentials.txt"
    echo "  $(cat /root/db_credentials.txt)"
fi
echo ""

if [ -f "${APP_DIR}/package.json" ]; then
    echo "✓ Project files detected"
    if [ -d "${APP_DIR}/.next" ]; then
        echo "✓ Application built"
        if check_service ${APP_NAME}; then
            echo "✓ Service is running"
            echo ""
            echo "Application should be available at: http://${DOMAIN}"
        else
            echo "⚠ Service is not running. Start it with: systemctl start ${APP_NAME}"
        fi
    else
        echo "⚠ Application not built yet. Run: cd ${APP_DIR} && sudo -u ${APP_USER} npm run build"
    fi
else
    echo "⚠ Project files not detected"
    echo ""
    echo "Next steps:"
    echo "1. Upload project files to ${APP_DIR}"
    echo "2. Run: cd ${APP_DIR} && sudo -u ${APP_USER} npm install"
    echo "3. Run: sudo -u ${APP_USER} npm run db:generate && npm run db:push"
    echo "4. Run: sudo -u ${APP_USER} npm run build"
    echo "5. Run: systemctl start ${APP_NAME}"
fi

echo ""
echo "Management commands:"
echo "  bachata-manage start    - Start application"
echo "  bachata-manage stop     - Stop application"
echo "  bachata-manage restart  - Restart application"
echo "  bachata-manage status   - Check status"
echo "  bachata-manage logs     - View logs"
echo "  bachata-manage rebuild  - Rebuild and restart"
echo ""
echo "Installation log: ${LOG_FILE}"
echo "=========================================="
echo ""
echo "=== Installation completed at $(date) ==="

