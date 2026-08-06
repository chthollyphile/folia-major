import type { Context, Next } from 'koa';
import { logger } from './logger';

type SummaryValue = Record<string, unknown>;
type ControllerHandler = (ctx: Context, next: Next) => Promise<unknown> | unknown;
type WrappedControllerHandler = (ctx: Context, next?: Next) => Promise<void>;

const MAX_ARRAY_ITEMS = 3;
const MAX_OBJECT_KEYS = 6;
const MAX_STRING_LENGTH = 80;
const MASKED_VALUE = '*** MASKED ***';
const SENSITIVE_KEYS = new Set([
  'authorization',
  'authst',
  'cookie',
  'cookies',
  'musickey',
  'qimei',
  'qimei36',
  'qqmusic_key',
  'qqmusic_uin',
  'token',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

const isSensitiveKey = (key: string, extras: ReadonlySet<string> = new Set()): boolean =>
  SENSITIVE_KEYS.has(key.toLowerCase()) || extras.has(key.toLowerCase());

const redactRecord = (
  value: Record<string, unknown>,
  extras: ReadonlySet<string> = new Set(),
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key, extras) ? MASKED_VALUE : item,
    ]),
  );

const trimString = (value: string) =>
  value.length > MAX_STRING_LENGTH
    ? {
        length: value.length,
        preview: `${value.slice(0, MAX_STRING_LENGTH)}...`,
      }
    : value;

const summarizeArray = (value: unknown[], depth: number): unknown => {
  if (depth >= 1) return { type: 'array', length: value.length };
  return {
    type: 'array',
    length: value.length,
    items: value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, depth + 1)),
  };
};

const summarizeObject = (value: Record<string, unknown>, depth: number): unknown => {
  const keys = Object.keys(value);
  if (depth >= 1) return { type: 'object', keys: keys.slice(0, MAX_OBJECT_KEYS) };
  const entries = keys
    .slice(0, MAX_OBJECT_KEYS)
    .map((key) => [
      key,
      isSensitiveKey(key) ? MASKED_VALUE : summarizeValue(value[key], depth + 1),
    ]);
  return Object.fromEntries(entries);
};

export const summarizeValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return trimString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (Buffer.isBuffer(value)) {
    return {
      type: 'buffer',
      length: value.length,
    };
  }
  if (Array.isArray(value)) return summarizeArray(value, depth);
  if (isPlainObject(value)) return summarizeObject(value, depth);
  return String(value);
};

const compactRecord = (record: Record<string, unknown>): SummaryValue =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null),
  );

export const summarizeRequestContext = (ctx: Context): SummaryValue => {
  const requestBody = (ctx.request as { body?: unknown }).body;
  const queryExtras = ctx.path.startsWith('/login/qr/') ? new Set(['key']) : new Set<string>();
  const query = redactRecord(ctx.query as Record<string, unknown>, queryExtras);

  return compactRecord({
    query: Object.keys(query).length ? summarizeValue(query) : undefined,
    params: Object.keys((ctx.params as Record<string, unknown>) || {}).length
      ? summarizeValue(ctx.params)
      : undefined,
    body: requestBody !== undefined ? summarizeValue(requestBody) : undefined,
  });
};

export const summarizeResponseBody = (body: unknown): unknown => summarizeValue(body);

export const sanitizeRequestUrl = (url: string): string => {
  const parsed = new URL(url, 'http://qq-music-api.local');
  const extras = parsed.pathname.startsWith('/login/qr/') ? new Set(['key']) : new Set<string>();
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (isSensitiveKey(key, extras)) parsed.searchParams.set(key, MASKED_VALUE);
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

const createControllerMeta = (controller: string, ctx: Context): SummaryValue => ({
  scope: 'controller',
  controller,
  route: ctx.path,
  method: ctx.method,
  params: summarizeRequestContext(ctx),
});

const logControllerCompletion = (ctx: Context, baseMeta: SummaryValue, startedAt: number): void => {
  const status = ctx.status || 200;
  const meta = {
    ...baseMeta,
    status,
    durationMs: Date.now() - startedAt,
    result: summarizeResponseBody(ctx.body),
  };
  if (status >= 500) logger.error('request.failed', meta);
  else if (status >= 400) logger.warn('request.validation_failed', meta);
  else logger.info('request.succeeded', meta);
};

const handleControllerError = (
  error: unknown,
  ctx: Context,
  baseMeta: SummaryValue,
  startedAt: number,
): void => {
  const normalizedError =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
  logger.error('request.failed', {
    ...baseMeta,
    status: 500,
    durationMs: Date.now() - startedAt,
    error: summarizeValue(normalizedError),
  });
  ctx.status = 500;
  if (ctx.body === undefined) ctx.body = { error: normalizedError.message };
};

export const withControllerLogging =
  (controller: string, handler: ControllerHandler): WrappedControllerHandler =>
  async (ctx: Context, next?: Next) => {
    const startedAt = Date.now();
    const baseMeta = createControllerMeta(controller, ctx);

    logger.info('request.received', baseMeta);

    try {
      const nextHandler: Next = next || (async () => Promise.resolve());
      await handler(ctx, nextHandler);
      logControllerCompletion(ctx, baseMeta, startedAt);
    } catch (error) {
      handleControllerError(error, ctx, baseMeta, startedAt);
    }
  };

const createServiceMeta = (service: string, upstream: string, params?: unknown): SummaryValue =>
  compactRecord({
    scope: 'service',
    service,
    upstream,
    params: params === undefined ? undefined : summarizeValue(params),
  });

export const logServiceRequest = (
  service: string,
  upstream: string,
  params?: unknown,
  extras: Record<string, unknown> = {},
): void => {
  logger.info('service.requesting', {
    ...createServiceMeta(service, upstream, params),
    ...compactRecord(extras),
  });
};

export const logServiceSuccess = (
  service: string,
  upstream: string,
  result?: unknown,
  extras: Record<string, unknown> = {},
): void => {
  logger.info('service.succeeded', {
    ...createServiceMeta(service, upstream),
    result: summarizeValue(result),
    ...compactRecord(extras),
  });
};

export const logServiceFailure = (
  service: string,
  upstream: string,
  error: unknown,
  params?: unknown,
  extras: Record<string, unknown> = {},
): void => {
  logger.error('service.failed', {
    ...createServiceMeta(service, upstream, params),
    error: summarizeValue(error),
    ...compactRecord(extras),
  });
};

export const logServiceBranch = (
  service: string,
  upstream: string,
  branch: string,
  details: Record<string, unknown> = {},
): void => {
  logger.debug('service.branch_selected', {
    ...createServiceMeta(service, upstream),
    branch,
    ...compactRecord(details),
  });
};
