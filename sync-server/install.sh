#!/bin/bash
set -e

GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
BOLD="\033[1m"
RESET="\033[0m"

echo -e "${CYAN}${BOLD}==========================================${RESET}"
echo -e "${CYAN}${BOLD}       Folia 同步服务端安装向导           ${RESET}"
echo -e "${CYAN}${BOLD}==========================================${RESET}"
echo ""

print_sync_token_reminder() {
    local token="$1"
    if [ -n "$token" ]; then
        echo -e "${CYAN}==========================================${RESET}"
        echo -e "${BOLD}${YELLOW}[!] 请注意：Folia 客户端连接密码 (SYNC_TOKEN) 为：${RESET}"
        echo -e "${BOLD}${GREEN}[!] $token${RESET}"
        echo -e "${BOLD}${RED}[!] 这是你在 Folia 客户端中连接同步服务端所需的密码。${RESET}"
        echo -e "${BOLD}${RED}[!] 由于安全原因，这是最后一次在此显示，请务必妥善保存！${RESET}"
        echo -e "${CYAN}==========================================${RESET}"
    fi
}

echo -e "${BOLD}请选择部署方式：${RESET}"
echo -e "  ${YELLOW}1)${RESET} Node (PM2)"
echo -e "  ${YELLOW}2)${RESET} Docker"
echo -e "  ${YELLOW}3)${RESET} Cloudflare Workers"
echo -ne "${BOLD}请输入选项 [1-3]: ${RESET}"
read deploy_choice

echo ""

setup_env_token() {
    if [ ! -f .env ]; then
        echo -e "${CYAN}==========================================${RESET}"
        echo -ne "${YELLOW}请输入用于客户端鉴权的 SYNC_TOKEN (建议>=8位): ${RESET}"
        read sync_token
        # Generate a 32-character hex dashboard token
        dashboard_token=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))" 2>/dev/null || echo $RANDOM$RANDOM$RANDOM$RANDOM)
        echo "SYNC_TOKEN=$sync_token" > .env
        echo "DASHBOARD_TOKEN=$dashboard_token" >> .env
        echo "PORT=3000" >> .env
        echo "DB_PATH=./folia-sync.db" >> .env
        echo -e "${GREEN}[*] .env 文件创建成功。${RESET}"
        echo -e "${CYAN}==========================================${RESET}"
        echo -e "${BOLD}${YELLOW}[!] 系统已为你自动生成网页看板 DASHBOARD_TOKEN：${RESET}"
        echo -e "${BOLD}${GREEN}[!] $dashboard_token${RESET}"
        echo -e "${BOLD}${RED}[!] 请务必妥善保存该 Token，你将需要它来访问网页看板。${RESET}"
        echo -e "${CYAN}==========================================${RESET}"
    else
        echo -e "${YELLOW}[*] .env 文件已存在，跳过创建。${RESET}"
    fi
}

case $deploy_choice in
    1)
        echo -e "${CYAN}[*] 开始进行 Node (PM2) 部署...${RESET}"
        
        # Check if Node.js is installed
        if ! command -v node &> /dev/null
        then
            echo -e "${RED}[!] 未检测到 Node.js 环境。${RESET}"
            echo -e "${CYAN}[*] 正在尝试自动安装 Node.js (v24 LTS 或等效版本)...${RESET}"
            if command -v apt-get &> /dev/null; then
                curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
                sudo apt-get install -y nodejs
            elif command -v dnf &> /dev/null; then
                curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
                sudo dnf install -y nodejs
            elif command -v yum &> /dev/null; then
                curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
                sudo yum install -y nodejs
            elif command -v pacman &> /dev/null; then
                sudo pacman -Sy --noconfirm nodejs npm
            elif command -v apk &> /dev/null; then
                sudo apk add --no-cache nodejs npm
            else
                echo -e "${RED}[!] 无法识别当前系统的包管理器 (apt/dnf/yum/pacman/apk)。${RESET}"
                echo -e "${RED}请手动安装 Node.js 和 npm 后重新运行此脚本。${RESET}"
                exit 1
            fi
        else
            echo -e "${GREEN}[*] 已经安装 Node.js：$(node -v)${RESET}"
        fi

        # Check if NPM is installed
        if ! command -v npm &> /dev/null
        then
            echo -e "${RED}[!] 未检测到 npm。请手动安装 npm 后重试。${RESET}"
            exit 1
        fi

        # Install PM2 globally if not present
        if ! command -v pm2 &> /dev/null
        then
            echo -e "${CYAN}[*] 正在全局安装 PM2...${RESET}"
            sudo npm install -g pm2
        fi

        echo -e "${CYAN}[*] 正在安装项目依赖...${RESET}"
        npm install

        echo -e "${CYAN}[*] 正在构建服务端...${RESET}"
        npm run build:node

        setup_env_token

        echo -e "${CYAN}[*] 正在使用 PM2 启动服务...${RESET}"
        # Delete the existing process if it exists, to restart it cleanly
        pm2 delete folia-sync-server 2>/dev/null || true
        pm2 start dist/node.js --name "folia-sync-server"

        echo -e "${CYAN}[*] 正在配置 PM2 日志轮转...${RESET}"
        pm2 install pm2-logrotate || true
        pm2 set pm2-logrotate:max_size 10M || true
        pm2 set pm2-logrotate:retain 3 || true

        echo -e "${CYAN}[*] 正在保存 PM2 进程列表...${RESET}"
        pm2 save

        echo -e "${GREEN}${BOLD}==========================================${RESET}"
        echo -e "${GREEN}${BOLD}    部署完成！                            ${RESET}"
        echo -e "${GREEN}${BOLD}==========================================${RESET}"
        echo -e "${CYAN}你的同步服务端已在 3000 端口运行。${RESET}"
        echo -e "使用此命令查看日志： ${BOLD}pm2 logs folia-sync-server${RESET}"
        echo -e "若要确保开机自启，请运行： ${BOLD}pm2 startup${RESET}"
        
        local_sync_token=""
        if [ -f .env ]; then
            local_sync_token=$(grep '^SYNC_TOKEN=' .env | cut -d '=' -f2-)
        fi
        print_sync_token_reminder "$local_sync_token"
        ;;
    2)
        echo -e "${CYAN}[*] 开始进行 Docker 部署...${RESET}"
        
        if ! command -v docker &> /dev/null
        then
            echo -e "${RED}[!] 未检测到 Docker 环境。请先手动安装 Docker。${RESET}"
            exit 1
        fi
        
        setup_env_token
        
        echo -e "${CYAN}[*] 正在构建并启动 Docker 容器...${RESET}"
        if docker compose version &> /dev/null; then
            docker compose up -d --build
        elif docker-compose --version &> /dev/null; then
            docker-compose up -d --build
        else
            echo -e "${RED}[!] 未检测到 docker compose 或 docker-compose 插件。${RESET}"
            exit 1
        fi
        
        echo -e "${GREEN}${BOLD}==========================================${RESET}"
        echo -e "${GREEN}${BOLD}    部署完成！                            ${RESET}"
        echo -e "${GREEN}${BOLD}==========================================${RESET}"
        echo -e "${CYAN}你的同步服务端已映射到本地 13000 端口（容器内 3000）。${RESET}"
        echo -e "使用此命令查看日志： ${BOLD}docker logs -f folia-sync${RESET}"
        
        local_sync_token=""
        if [ -f .env ]; then
            local_sync_token=$(grep '^SYNC_TOKEN=' .env | cut -d '=' -f2-)
        fi
        print_sync_token_reminder "$local_sync_token"
        ;;
    3)
        echo -e "${CYAN}[*] 开始进行 Cloudflare Workers 部署...${RESET}"
        
        # Check if NPM is installed
        if ! command -v npm &> /dev/null
        then
            echo -e "${RED}[!] 未检测到 npm。请手动安装 Node.js 和 npm 后重试。${RESET}"
            exit 1
        fi
        
        echo -e "${CYAN}[*] 正在安装项目依赖...${RESET}"
        npm install
        
        echo -e "${CYAN}[*] 正在检查或创建 D1 数据库 'folia-sync' (可能要求跳转浏览器登录)...${RESET}"
        d1_output=$(npx wrangler d1 create folia-sync -c wrangler.toml 2>&1 || true)
        
        # If it already exists, fetch its info instead to grab the ID
        if echo "$d1_output" | grep -q "already exists"; then
            echo -e "${YELLOW}[*] 数据库 'folia-sync' 已存在。正在获取它的 ID...${RESET}"
            db_id=$(npx wrangler d1 list --json 2>/dev/null | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf-8')); console.log(d.find(x => x.name === 'folia-sync')?.uuid || '')" 2>/dev/null)
        else
            echo "$d1_output"
            # Extract the UUID database_id
            db_id=$(echo "$d1_output" | grep -oE "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" | head -n 1)
        fi
        
        if [ -z "$db_id" ]; then
            echo -e "${RED}[!] 无法自动提取 D1 database_id。${RESET}"
            echo -ne "${YELLOW}请从上方的输出中手动复制并粘贴你的 D1 database_id: ${RESET}"
            read db_id
        fi
        
        echo -e "${CYAN}[*] 正在生成 wrangler.local.toml...${RESET}"
        cp wrangler.toml wrangler.local.toml
        # Replace the placeholder with the actual db_id (compatible with macOS and Linux sed)
        sed -i.bak "s/replace-with-your-d1-database-id/$db_id/g" wrangler.local.toml && rm -f wrangler.local.toml.bak
        
        echo -e "${CYAN}==========================================${RESET}"
        echo -ne "${YELLOW}请输入用于客户端鉴权的 SYNC_TOKEN (至少8位): ${RESET}"
        read cf_sync_token
        
        echo -e "${CYAN}[*] 正在将 SYNC_TOKEN 注入 Cloudflare 环境变量...${RESET}"
        echo "$cf_sync_token" | npx wrangler secret put SYNC_TOKEN --config wrangler.local.toml
        
        echo -e "${CYAN}[*] 正在自动生成并注入 DASHBOARD_TOKEN...${RESET}"
        dashboard_token=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))" 2>/dev/null || echo $RANDOM$RANDOM$RANDOM$RANDOM)
        echo "$dashboard_token" | npx wrangler secret put DASHBOARD_TOKEN --config wrangler.local.toml
        
        echo -e "${CYAN}[*] 正在向 Cloudflare 边缘网络部署代码...${RESET}"
        npm run deploy:cf -- --config wrangler.local.toml
        
        echo -e "${GREEN}${BOLD}==========================================${RESET}"
        echo -e "${GREEN}${BOLD}    部署完成！                            ${RESET}"
        echo -e "${GREEN}${BOLD}==========================================${RESET}"
        echo -e "${CYAN}你的服务已成功部署至 Cloudflare Workers。${RESET}"
        echo -e "${CYAN}==========================================${RESET}"
        echo -e "${BOLD}${YELLOW}[!] 系统已为你自动生成网页看板 DASHBOARD_TOKEN：${RESET}"
        echo -e "${BOLD}${GREEN}[!] $dashboard_token${RESET}"
        echo -e "${BOLD}${RED}[!] 请务必妥善保存该 Token，你将需要它来访问网页看板。${RESET}"
        echo -e "${CYAN}访问链接格式: https://<你的Worker域名>/?token=$dashboard_token${RESET}"
        
        print_sync_token_reminder "$cf_sync_token"
        ;;
    *)
        echo -e "${RED}[!] 无效的选择。退出脚本。${RESET}"
        exit 1
        ;;
esac
