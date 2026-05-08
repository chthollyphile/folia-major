import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv, type ConfigEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function viteConfig({ mode }: ConfigEnv): Promise<UserConfig> {
  const env = loadEnv(mode, '.', '');

  let commitHash = '';
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    commitHash = process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
  } else {
    try {
      commitHash = execSync('git rev-parse --short HEAD').toString().trim();
    } catch (e) {
      console.warn('Could not get commit hash:', e);
      commitHash = 'unknown, probably dev version';
    }
  }

  let gitBranch = '';
  if (process.env.VERCEL_GIT_COMMIT_REF) {
    gitBranch = process.env.VERCEL_GIT_COMMIT_REF;
  } else {
    try {
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    } catch (e) {
      console.warn('Could not get git branch:', e);
      gitBranch = 'unknown';
    }
  }

  let commitSuffix = '';
  if (commitHash && commitHash !== 'unknown, probably dev version') {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`https://namoe.izuna.top/api/namoe?hash=${commitHash}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as { name?: string };
        if (data?.name) {
          commitSuffix = `/${data.name}`;
        }
      }
    } catch (e) {
      // Ignore errors during fetch to prevent build failure
    }
  }

  return {
    base: process.env.ELECTRON === 'true' ? './' : '/',
    worker: {
      format: 'es'
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          stageClient: path.resolve(__dirname, 'stage-client.html'),
          foliaConductor: path.resolve(__dirname, 'folia-conductor/index.html'),
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        devOptions: {
          enabled: true
        },
        manifest: {
          name: 'Folia Music',
          short_name: 'Folia',
          description: 'A beautiful AI-themed music player',
          theme_color: '#09090b',
          background_color: '#09090b',
          display: 'standalone',
          icons: [
            {
              src: 'icon.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      '__COMMIT_HASH__': JSON.stringify(commitHash + commitSuffix),
      '__GIT_BRANCH__': JSON.stringify(gitBranch),
      '__APP_VERSION__': JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')).version)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    }
  };
}
