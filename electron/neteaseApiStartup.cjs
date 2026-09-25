// electron/neteaseApiStartup.cjs

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_JITTER_MS = 100;
const DEFAULT_OPERATION_TIMEOUT_MS = 10000;

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

// Bounds a single startup network call. The upstream api-enhanced requests carry no axios timeout,
// so a black-holed route to interface.music.163.com would otherwise stall startup until the OS
// gives up on the socket (minutes on some platforms). Pass timeoutMs = 0 to opt out.
function withTimeout(promise, timeoutMs, label) {
  if (!(timeoutMs > 0)) {
    return promise;
  }

  let timer = null;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === 'string' && error.trim() ? error : 'Unknown error';
}

function hasUsableXeapiPublicKey(publicKey) {
  return Boolean(
    publicKey
    && typeof publicKey === 'object'
    && typeof publicKey.sk === 'string'
    && publicKey.sk.trim(),
  );
}

function getAnonymousCookie(registration) {
  const bodyCookie = registration?.body?.cookie;
  if (typeof bodyCookie === 'string' && bodyCookie.trim()) {
    return bodyCookie;
  }

  const responseCookies = registration?.cookie;
  if (Array.isArray(responseCookies)) {
    return responseCookies
      .filter((cookie) => typeof cookie === 'string' && cookie.trim())
      .join(';');
  }

  return typeof responseCookies === 'string' ? responseCookies : '';
}

function describeAnonymousRegistration(registration) {
  const status = registration?.status;
  const code = registration?.body?.code;
  const message = registration?.body?.message || registration?.body?.msg;
  const details = [
    status !== undefined ? `status=${status}` : '',
    code !== undefined ? `code=${code}` : '',
    typeof message === 'string' && message.trim() ? `message=${message.trim()}` : '',
  ].filter(Boolean);

  return details.length > 0 ? ` (${details.join(', ')})` : '';
}

// Retries a short startup operation with bounded exponential backoff and jitter.
async function retryStartupOperation(operation, options = {}) {
  const attempts = options.attempts || DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const jitterMs = options.jitterMs ?? DEFAULT_RETRY_JITTER_MS;
  const sleep = options.sleep || wait;
  const random = options.random || Math.random;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }

      options.onRetry?.(error, attempt);
      const exponentialDelay = baseDelayMs * (2 ** (attempt - 1));
      const jitter = Math.floor(random() * jitterMs);
      await sleep(exponentialDelay + jitter);
    }
  }

  throw new Error('Startup operation exhausted its retry attempts');
}

// Refreshes the xeapi key and falls back only when the cached key is still usable.
async function resolveXeapiPublicKey({
  currentPublicKey,
  deviceId,
  getXeapiPublicKey,
  logger = console,
  retryOptions,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
}) {
  try {
    const publicKey = await retryStartupOperation(
      async () => {
        const refreshedPublicKey = await withTimeout(
          getXeapiPublicKey(currentPublicKey, deviceId),
          timeoutMs,
          'xeapi public key refresh',
        );
        if (!hasUsableXeapiPublicKey(refreshedPublicKey)) {
          throw new Error('xeapi public key response missing sk');
        }
        return refreshedPublicKey;
      },
      {
        ...retryOptions,
        onRetry: (error, attempt) => {
          logger.warn(
            `[Netease API] Failed to refresh xeapi public key (attempt ${attempt}), retrying: ${getErrorMessage(error)}`,
          );
          retryOptions?.onRetry?.(error, attempt);
        },
      },
    );

    return { publicKey, refreshed: true };
  } catch (error) {
    if (!hasUsableXeapiPublicKey(currentPublicKey)) {
      throw error;
    }

    logger.warn(
      `[Netease API] Failed to refresh xeapi public key, using cached key: ${getErrorMessage(error)}`,
    );
    return { publicKey: currentPublicKey, refreshed: false };
  }
}

// Refreshes the anonymous token without making this optional credential block startup.
async function refreshAnonymousToken({
  registerAnonymous,
  cookieToJson,
  persistToken,
  logger = console,
  retryOptions,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
}) {
  try {
    await retryStartupOperation(async () => {
      const registration = await withTimeout(
        registerAnonymous(),
        timeoutMs,
        'anonymous registration',
      );
      const anonymousCookie = getAnonymousCookie(registration);
      if (!anonymousCookie.trim()) {
        throw new Error(
          `anonymous registration response missing cookie${describeAnonymousRegistration(registration)}`,
        );
      }

      const cookieObject = cookieToJson(anonymousCookie);
      if (typeof cookieObject.MUSIC_A !== 'string' || !cookieObject.MUSIC_A.trim()) {
        throw new Error('anonymous registration response missing MUSIC_A');
      }

      await persistToken(cookieObject.MUSIC_A);
    }, {
      ...retryOptions,
      onRetry: (error, attempt) => {
        logger.warn(
          `[Netease API] Failed to refresh anonymous token (attempt ${attempt}), retrying: ${getErrorMessage(error)}`,
        );
        retryOptions?.onRetry?.(error, attempt);
      },
    });
    return true;
  } catch (error) {
    logger.warn(
      `[Netease API] Failed to refresh anonymous token, keeping existing token: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

// 与 Docker 镜像（deploy/docker/scripts/patch-music-api-client-ip.mjs）同一策略：只有显式传了
// randomCNIP 的请求才带伪造的来源 IP，其余请求不写 X-Real-IP / X-Forwarded-For，由网易按连接本身
// 识别真实公网出口。上游默认会把本机请求的 127.0.0.1 写进去，从 ::1 进来的还会换成随机国内 IP；
// 后者与手机扫码时的位置对不上，会让扫码确认失败。
function withoutImplicitClientIp(request) {
  return (uri, data, options = {}) => request(uri, data, options.randomCNIP ? options : { ...options, ip: '' });
}

module.exports = {
  DEFAULT_OPERATION_TIMEOUT_MS,
  hasUsableXeapiPublicKey,
  refreshAnonymousToken,
  resolveXeapiPublicKey,
  retryStartupOperation,
  withTimeout,
  withoutImplicitClientIp,
};
