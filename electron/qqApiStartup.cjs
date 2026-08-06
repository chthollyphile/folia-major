// electron/qqApiStartup.cjs
//
// Starts the bundled qq-music-api inside the Electron main process. The bundle is produced by
// packaging/build-qq-api-bundle.mjs from the vendored source in deploy/docker/qq-api/source, so the
// desktop app carries no koa/zod/moment dependencies of its own and no ws@7 vs ws@8 conflict.

const fs = require('fs');
const path = require('path');

const BUNDLE_PATH = path.join(__dirname, 'vendor', 'qqMusicApi.cjs');

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === 'string' && error.trim() ? error : 'Unknown error';
}

function isBundleAvailable(bundlePath = BUNDLE_PATH) {
  return fs.existsSync(bundlePath);
}

// The bundle calls app.listen() while it is being required, so require() returns before the socket
// is bound. Resolving only on 'listening' keeps the caller from reporting "running" against a port
// that may still fail to bind; a bind failure arrives as 'error' and is surfaced as a rejection
// rather than an unhandled event on the server.
function waitUntilListening(server) {
  return new Promise((resolve, reject) => {
    if (server.listening) {
      resolve(server);
      return;
    }

    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };

    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

// The bundled app listens on import and reads PORT at config load, so the environment is prepared
// first and restored afterwards to keep the main process environment untouched.
async function startQqApi(options = {}) {
  const {
    port,
    stateFilePath,
    bundlePath = BUNDLE_PATH,
    loadBundle = (target) => require(target),
    env = process.env,
  } = options;

  if (!port) {
    throw new Error('A port is required to start the QQ API');
  }

  if (!isBundleAvailable(bundlePath)) {
    throw new Error(
      `QQ API bundle is missing at ${bundlePath}. Run: npm run build:qq-api`,
    );
  }

  const previous = {
    PORT: env.PORT,
    NODE_ENV: env.NODE_ENV,
    AUTO_OPEN_EXPLORER: env.AUTO_OPEN_EXPLORER,
    QQ_AUTH_STATE_PATH: env.QQ_AUTH_STATE_PATH,
    QQ_DISABLE_UPDATE_CHECK: env.QQ_DISABLE_UPDATE_CHECK,
  };

  const restore = () => {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    });
  };

  env.PORT = String(port);
  env.AUTO_OPEN_EXPLORER = 'false';
  env.QQ_DISABLE_UPDATE_CHECK = 'true';
  if (stateFilePath) {
    env.QQ_AUTH_STATE_PATH = stateFilePath;
  }

  let bundle;
  try {
    bundle = loadBundle(bundlePath);
  } finally {
    restore();
  }

  const server = bundle && (bundle.server || (bundle.default && bundle.default.server));
  if (!server || typeof server.once !== 'function') {
    throw new Error(
      'QQ API bundle did not expose an HTTP server. Rebuild it with: npm run build:qq-api',
    );
  }

  await waitUntilListening(server);

  // Once bound, later socket errors must not take the main process down with an unhandled 'error'.
  server.on('error', (error) => {
    console.error('[QQ API] server error', error);
  });

  return {
    port,
    stateFilePath: stateFilePath || null,
    server,
    close: () => closeServer(server),
  };
}

module.exports = {
  BUNDLE_PATH,
  getErrorMessage,
  isBundleAvailable,
  startQqApi,
};
