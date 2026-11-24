const { keepServerErrorsLogged, waitUntilListening } = require('./backendLifecycle.cjs');

// sources/qq/main/qqApiStartup.cjs
//
// Starts @yakult-green-tea/qq-music-api inside the Electron main process, from the mod's main entry (main/index.ts).
// The package is the mod's own dependency, packed into its deps archive (package.json `folia.dependencies`), so it
// brings its own ws@7 and the app's ws@8 is left alone. `loadModule` may answer a promise: the main entry loads the
// package from the archive with a dynamic import.

const QQ_API_MODULE = '@yakult-green-tea/qq-music-api';

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === 'string' && error.trim() ? error : 'Unknown error';
}

// A missing package is a packaging problem the user can act on; anything else (a port that is
// already taken, a throw from inside the package) is a runtime failure. Callers map the two to
// different statuses, so the distinction must survive the throw.
function isModuleNotFound(error) {
  return Boolean(error) && error.code === 'MODULE_NOT_FOUND';
}

// The package calls app.listen() while it is being required, so require() returns before the socket
// is bound. Resolving only on 'listening' (waitUntilListening) keeps the caller from reporting "running"
// against a port that may still fail to bind; a bind failure arrives as a rejection rather than an
// unhandled event on the server.

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

// The environment is shared by the whole main process, and the window in which PORT and the others are set spans the
// awaited load. Two starts whose windows overlapped (an old copy of the mod still starting while a reloaded copy starts,
// say) would each save the other's values as "previous" and the last to restore would leave a PORT behind. So the
// windows are taken one at a time, through one chain kept on globalThis: a reload drops this file from the module cache
// and a new copy of it would otherwise have a chain of its own.
// A window that never ends (a load that hangs) would hold every later start of this process behind it, a reloaded copy
// of the mod's too; past ENV_WINDOW_WAIT_MS the next one goes ahead without it.
const ENV_WINDOW_KEY = Symbol.for('folia.sources.qq.envWindow');
const ENV_WINDOW_WAIT_MS = 30_000;

function withinWait(previous, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    previous.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function inEnvWindow(run, waitMs = ENV_WINDOW_WAIT_MS) {
  const holder = globalThis;
  const previous = holder[ENV_WINDOW_KEY] || Promise.resolve();
  const result = withinWait(previous, waitMs).then(run);
  // The next window waits for this one to end, whether it loaded the package or threw.
  holder[ENV_WINDOW_KEY] = result.then(() => undefined, () => undefined);
  return result;
}

// The package listens on import and reads PORT at config load, so the environment is prepared first
// and restored afterwards to keep the main process environment untouched.
//
// ⚠️ Call this at most once per load of the mod. require() caches modules, so a second call would not start
// a second server: it would return the cached module, i.e. the *previous* server bound to the
// *previous* port, while reporting the port passed in this time. Do not add a retry path here
// without first solving the cache (there is no supported way to re-listen on the exported server).
// The mod system drops the mod's whole folder (its deps archive too) from the cache before it loads the main
// entry again (purgeModuleCache in electron/modSystem/nodeEntry.cjs), so a mod switched off and on again loads
// the package anew and gets a new server.
async function startQqApi(options = {}) {
  const {
    port,
    stateFilePath,
    authSessionRepository,
    moduleId = QQ_API_MODULE,
    loadModule = (target) => require(target),
    env = process.env,
  } = options;

  if (!port) {
    throw new Error('A port is required to start the QQ API');
  }

  const qqApi = await inEnvWindow(() => loadWithEnvironment({
    port, stateFilePath, authSessionRepository, moduleId, loadModule, env,
  }));

  const server = qqApi && (qqApi.server || (qqApi.default && qqApi.default.server));
  if (!server || typeof server.once !== 'function') {
    throw new Error(
      `QQ API package ${moduleId} did not expose an HTTP server`,
    );
  }

  await waitUntilListening(server);

  // Once bound, later socket errors must not take the main process down with an unhandled 'error'.
  keepServerErrorsLogged(server, 'QQ API');

  return {
    port,
    stateFilePath: stateFilePath || null,
    server,
    close: () => closeServer(server),
  };
}

// Sets the environment the package reads, loads it (which starts its listen) and puts the environment back, also when
// the load throws. Runs inside inEnvWindow only.
async function loadWithEnvironment({ port, stateFilePath, authSessionRepository, moduleId, loadModule, env }) {
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

  let qqApi;
  try {
    qqApi = await loadModule(moduleId);
    if (authSessionRepository) {
      const configureAuthSessionRepository = qqApi && (
        qqApi.configureAuthSessionRepository ||
        (qqApi.default && qqApi.default.configureAuthSessionRepository)
      );
      if (typeof configureAuthSessionRepository !== 'function') {
        throw new Error(
          `QQ API package ${moduleId} does not support auth session persistence`,
        );
      }
      // require() starts the server, but Node cannot accept an HTTP request until this synchronous
      // stack returns. Injecting here restores encrypted credentials before the first status probe.
      configureAuthSessionRepository(authSessionRepository);
    }
  } catch (error) {
    if (isModuleNotFound(error)) {
      const missing = new Error(
        `QQ API package ${moduleId} is not installed. Run: npm install`,
        { cause: error },
      );
      missing.code = 'MODULE_NOT_FOUND';
      throw missing;
    }

    throw error;
  } finally {
    restore();
  }

  return qqApi;
}

module.exports = {
  QQ_API_MODULE,
  getErrorMessage,
  isModuleNotFound,
  inEnvWindow,
  startQqApi,
};
