const http = require('http');
const url = require('url');

// electron/spotifyAuth.cjs
// Spotify 本地 OAuth 回调服务器：在 127.0.0.1:32110 监听 /callback，截获授权码并通知渲染进程

let server = null;
let pendingResolve = null;
let currentCode = null;

const SPOTIFY_CALLBACK_PORT = 32110;

/** 转义回调 query 里带进来的文本，避免错误信息被当成 HTML 执行 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

/**
 * 渲染回调结果页：只有真的拿到授权码才显示成功
 * 之前无论 Spotify 返回什么这里都写着「授权成功」，用户在应用侧报错时完全对不上原因
 */
function renderCallbackPage({ ok, detail }) {
  const heading = ok ? 'Spotify 授权成功！' : 'Spotify 授权没有完成';
  const accent = ok ? '#1DB954' : '#E22134';
  const message = ok
    ? '已与 Folia 建立连接，你可以关闭此网页并返回 Folia 继续听歌。'
    : `原因：${detail}。请回到 Folia 重新登录；若提示账号不在白名单，请在弹窗里填写自己的 Spotify Client ID。`;
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>${heading}</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 90vh; margin: 0; background: #121212; color: #fff;">
      <div style="background: #181818; padding: 40px; border-radius: 20px; text-align: center; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);">
        <h2 style="color: ${accent}; margin-top: 0;">${heading}</h2>
        <p style="color: #b3b3b3; line-height: 1.6;">${message}</p>
      </div>
      ${ok ? '<script>setTimeout(() => window.close(), 2500);</script>' : ''}
    </body>
    </html>
  `;
}

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
        const callbackOk = Boolean(code);
        res.writeHead(callbackOk ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderCallbackPage({
          ok: callbackOk,
          detail: escapeHtml(error || '回调里没有授权码，可能授权被取消或重定向地址不匹配'),
        }));

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
        // 端口被占用时不能假装成功：那样应用会一直等一个不会来的回调，浏览器那边可能被别的进程接走
        // 并显示成功页，排查时毫无线索。直接失败，让错误原文进入登录诊断。
        server = null;
        reject(new Error(`本地回调端口 ${SPOTIFY_CALLBACK_PORT} 已被占用，请关闭其他 Folia 实例或占用该端口的程序后重试`));
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
