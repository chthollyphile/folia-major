#!/bin/bash
set -e

echo "=========================================="
echo "    Folia Sync Server Setup Script        "
echo "=========================================="
echo ""

echo "Please select the deployment method:"
echo "1) Node (PM2)"
echo "2) Docker"
echo "3) Cloudflare Workers"
read -p "Enter choice [1-3]: " deploy_choice

echo ""

setup_env_token() {
    if [ ! -f .env ]; then
        echo "=========================================="
        read -p "Enter a secure SYNC_TOKEN for your server: " sync_token
        echo "SYNC_TOKEN=$sync_token" > .env
        echo "PORT=3000" >> .env
        echo "DB_PATH=./folia-sync.db" >> .env
        echo "[*] .env file created successfully."
    else
        echo "[*] .env file already exists, skipping creation."
    fi
}

case $deploy_choice in
    1)
        echo "[*] Starting Node (PM2) deployment..."
        
        # Check if Node.js is installed
        if ! command -v node &> /dev/null
        then
            echo "[!] Node.js could not be found."
            echo "[*] Attempting to install Node.js (v24 LTS or equivalent)..."
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
                echo "[!] Could not detect package manager (apt/dnf/yum/pacman/apk)."
                echo "Please install Node.js and npm manually, then run this script again."
                exit 1
            fi
        else
            echo "[*] Node.js is already installed: $(node -v)"
        fi

        # Check if NPM is installed
        if ! command -v npm &> /dev/null
        then
            echo "[!] npm could not be found. Please install npm manually."
            exit 1
        fi

        # Install PM2 globally if not present
        if ! command -v pm2 &> /dev/null
        then
            echo "[*] Installing PM2 globally..."
            sudo npm install -g pm2
        fi

        echo "[*] Installing dependencies..."
        npm install

        echo "[*] Building the server..."
        npm run build:node

        setup_env_token

        echo "[*] Starting the server with PM2..."
        # Delete the existing process if it exists, to restart it cleanly
        pm2 delete folia-sync-server 2>/dev/null || true
        pm2 start dist/node.js --name "folia-sync-server"

        echo "[*] Setting up PM2 log rotation..."
        pm2 install pm2-logrotate || true
        pm2 set pm2-logrotate:max_size 10M || true
        pm2 set pm2-logrotate:retain 3 || true

        echo "[*] Saving PM2 process list..."
        pm2 save

        echo "=========================================="
        echo "    Setup Complete!                       "
        echo "=========================================="
        echo "Your server is running on port 3000."
        echo "You can view logs using: pm2 logs folia-sync-server"
        echo "To ensure PM2 starts on boot, run: pm2 startup"
        ;;
    2)
        echo "[*] Starting Docker deployment..."
        
        if ! command -v docker &> /dev/null
        then
            echo "[!] Docker could not be found. Please install Docker manually."
            exit 1
        fi
        
        setup_env_token
        
        echo "[*] Building and starting the Docker container..."
        if docker compose version &> /dev/null; then
            docker compose up -d --build
        elif docker-compose --version &> /dev/null; then
            docker-compose up -d --build
        else
            echo "[!] Neither docker compose nor docker-compose could be found."
            exit 1
        fi
        
        echo "=========================================="
        echo "    Setup Complete!                       "
        echo "=========================================="
        echo "Your server is running on port 13000 (mapped to container's 3000)."
        echo "You can view logs using: docker logs -f folia-sync"
        ;;
    3)
        echo "[*] Starting Cloudflare Workers deployment..."
        
        # Check if NPM is installed
        if ! command -v npm &> /dev/null
        then
            echo "[!] npm could not be found. Please install Node.js and npm manually."
            exit 1
        fi
        
        echo "[*] Installing dependencies..."
        npm install
        
        echo "[*] Creating D1 Database 'folia-sync' (will prompt login if needed)..."
        d1_output=$(npx wrangler d1 create folia-sync -c wrangler.toml 2>&1 || true)
        
        # If it already exists, fetch its info instead to grab the ID
        if echo "$d1_output" | grep -q "already exists"; then
            echo "[*] Database 'folia-sync' already exists. Fetching its ID..."
            d1_output=$(npx wrangler d1 info folia-sync -c wrangler.toml 2>&1 || true)
        else
            echo "$d1_output"
        fi
        
        # Extract the UUID database_id
        db_id=$(echo "$d1_output" | grep -oE "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" | head -n 1)
        
        if [ -z "$db_id" ]; then
            echo "[!] Could not automatically extract the D1 database ID."
            read -p "Please manually enter your D1 database_id from the output above: " db_id
        fi
        
        echo "[*] Generating wrangler.local.toml..."
        cp wrangler.toml wrangler.local.toml
        # Replace the placeholder with the actual db_id (compatible with macOS and Linux sed)
        sed -i.bak "s/replace-with-your-d1-database-id/$db_id/g" wrangler.local.toml && rm -f wrangler.local.toml.bak
        
        echo "=========================================="
        read -p "Enter a secure SYNC_TOKEN for your Cloudflare Worker (>= 8 chars): " cf_sync_token
        
        echo "[*] Setting SYNC_TOKEN secret..."
        echo "$cf_sync_token" | npx wrangler secret put SYNC_TOKEN --config wrangler.local.toml
        
        echo "[*] Deploying to Cloudflare Workers..."
        npm run deploy:cf -- --config wrangler.local.toml
        
        echo "=========================================="
        echo "    Setup Complete!                       "
        echo "=========================================="
        echo "Your server has been deployed to Cloudflare Workers."
        ;;
    *)
        echo "[!] Invalid choice. Exiting."
        exit 1
        ;;
esac
