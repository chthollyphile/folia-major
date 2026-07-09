#!/bin/bash
set -e

echo "=========================================="
echo "    Folia Sync Server Setup Script        "
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
    echo "[!] Node.js could not be found."
    echo "[*] Installing Node.js (v24 LTS)..."
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
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

# Ask for SYNC_TOKEN if .env doesn't exist
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

echo "[*] Starting the server with PM2..."
# Delete the existing process if it exists, to restart it cleanly
pm2 delete folia-sync-server 2>/dev/null || true
pm2 start dist/node.js --name "folia-sync-server"

echo "[*] Setting up PM2 log rotation..."
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 3

echo "[*] Saving PM2 process list..."
pm2 save

echo "=========================================="
echo "    Setup Complete!                       "
echo "=========================================="
echo "Your server is running on port 3000."
echo "You can view logs using: pm2 logs folia-sync-server"
echo "To ensure PM2 starts on boot, run: pm2 startup"
