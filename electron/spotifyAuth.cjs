const http = require('http');
const url = require('url');

// electron/spotifyAuth.cjs
// Spotify 本地 OAuth 回调服务器：在 127.0.0.1:32110 监听 /callback，截获授权码并通知渲染进程

let server = null;
let pendingResolve = null;
let currentCode = null;

const SPOTIFY_CALLBACK_PORT = 32110;

/**
 * 启动 Spotify OAuth 本地回调监听服务
 */
function startSpotifyAuthServer() {
  if (server) {
    return Promise.resolve({ port: SPOTIFY_CALLBACK_PORT, url: `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}/callback` });
  }

  currentCode = null;
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/callback') {
        const { code, error, state } = parsedUrl.query;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><title>Spotify 授权成功</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 90vh; margin: 0; background: #121212; color: #fff;">
            <div style="background: #181818; padding: 40px; border-radius: 20px; text-align: center; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);">
              <h2 style="color: #1DB954; margin-top: 0;">Spotify 授权成功！</h2>
              <p style="color: #b3b3b3; line-height: 1.6;">已成功与 Folia 建立连接，你可以关闭此网页并返回 Folia 继续听歌。</p>
            </div>
            <script>setTimeout(() => window.close(), 2500);</script>
          </body>
          </html>
        `);

        if (code) {
          currentCode = { code, state };
          if (pendingResolve) {
            pendingResolve(currentCode);
            pendingResolve = null;
          }
        } else if (error) {
          if (pendingResolve) {
            pendingResolve({ error, state });
            pendingResolve = null;
          }
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(SPOTIFY_CALLBACK_PORT, '127.0.0.1', () => {
      resolve({ port: SPOTIFY_CALLBACK_PORT, url: `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}/callback` });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ port: SPOTIFY_CALLBACK_PORT, url: `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}/callback` });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * 等待用户在浏览器完成 Spotify 授权并返回 code
 */
function waitForSpotifyAuthCode() {
  if (currentCode) {
    const res = currentCode;
    currentCode = null;
    return Promise.resolve(res);
  }
  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

/**
 * 停止本地 OAuth 回调服务器
 */
function stopSpotifyAuthServer() {
  if (server) {
    server.close();
    server = null;
  }
  pendingResolve = null;
  currentCode = null;
}

module.exports = {
  startSpotifyAuthServer,
  waitForSpotifyAuthCode,
  stopSpotifyAuthServer,
};
