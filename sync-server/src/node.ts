import { serve } from '@hono/node-server';
import { D1Emulator } from './d1-emulator.js';
import app from './app.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Try to load basic .env file if it exists
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
} catch (e) {
  // Ignore
}

const SYNC_TOKEN = process.env.SYNC_TOKEN;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../folia-sync.db');

if (!SYNC_TOKEN) {
  console.error('\x1b[31m[ERROR]\x1b[0m SYNC_TOKEN environment variable is missing.');
  console.error('Please set it via .env file or environment variable.');
  process.exit(1);
}

if (SYNC_TOKEN.length < 8) {
  console.error('\x1b[31m[ERROR]\x1b[0m SYNC_TOKEN is too weak. Must be at least 8 characters long.');
  process.exit(1);
}

const db = new D1Emulator(DB_PATH);

const logo = `
\x1b[35m  _____    _ _          \x1b[36m ____                  \x1b[0m
\x1b[35m |  ___|__| (_) __ _    \x1b[36m/ ___| _   _ _ __   ___ \x1b[0m
\x1b[35m | |_ / _ \\ | |/ _\` |   \x1b[36m\\___ \\| | | | '_ \\ / __|\x1b[0m
\x1b[35m |  _| (_) | | | (_| |  \x1b[36m ___) | |_| | | | | (__ \x1b[0m
\x1b[35m |_|  \\___/|_|_|\\__,_|  \x1b[36m|____/ \\__, |_| |_|\\___|\x1b[0m
\x1b[36m                               |___/            \x1b[0m
`;

let version = 'unknown';
try {
  const pkgPath = path.resolve(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  version = pkg.version;
} catch (e) {
  // Ignore
}

console.log(logo);
console.log(`\x1b[32m[Folia Sync Server]\x1b[0m Starting Node.js standalone server (v${version})...`);
console.log(`- Port: \x1b[33m${PORT}\x1b[0m`);
console.log(`- Database: \x1b[33m${DB_PATH}\x1b[0m`);
if (DASHBOARD_TOKEN) {
  console.log(`- Dashboard: \x1b[36mhttp://localhost:${PORT}/?token=${DASHBOARD_TOKEN}\x1b[0m`);
} else {
  console.log(`- Dashboard: Disabled (DASHBOARD_TOKEN not set)`);
}

serve({
  fetch: (req) => app.fetch(req, {
    FOLIA_SYNC_DB: db,
    SYNC_TOKEN,
    DASHBOARD_TOKEN,
  }),
  port: PORT,
});
