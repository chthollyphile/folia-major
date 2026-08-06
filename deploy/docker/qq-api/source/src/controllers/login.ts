import type { Context } from 'koa';
import qrLoginService, {
  DEFAULT_LOGIN_CHANNEL,
  isSupportedLoginChannel,
  QrLoginServiceError,
  SUPPORTED_LOGIN_CHANNELS,
} from '../services/auth/qrLogin';
import { getTypedQuery } from '../types/core/request';

export const AUTH_COOKIE_NAME = 'qqmusic_session';

interface LoginQuery {
  key?: string;
  cookie?: string;
  channel?: string;
}

const tokenFromCookieString = (cookie: string): string | undefined => {
  for (const entry of cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    if (entry.slice(0, separator).trim() === AUTH_COOKIE_NAME)
      return entry.slice(separator + 1).trim() || undefined;
  }
  return undefined;
};

export const getAuthToken = (ctx: Context): string | undefined => {
  const query = getTypedQuery<LoginQuery>(ctx);
  return tokenFromCookieString(String(query.cookie ?? '')) || ctx.cookies.get(AUTH_COOKIE_NAME);
};

const setServiceError = (ctx: Context, error: unknown): void => {
  if (error instanceof QrLoginServiceError) {
    ctx.status = error.httpStatus;
    if (error.retryAfterMs) ctx.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
    // upstreamCode stays an opaque upstream number; it is never renamed into an official meaning.
    ctx.body = {
      code: error.httpStatus,
      message: error.message,
      retryAfterMs: error.retryAfterMs,
      ...(error.upstreamCode === undefined ? {} : { upstreamCode: error.upstreamCode }),
    };
    return;
  }
  throw error;
};

export const qrKey = async (ctx: Context): Promise<void> => {
  // Optional and backward compatible: no `channel` means the QQ Music App QR, which is what
  // every existing caller gets today. The response shape is unchanged either way.
  const { channel = DEFAULT_LOGIN_CHANNEL } = getTypedQuery<LoginQuery>(ctx);
  if (!isSupportedLoginChannel(channel)) {
    ctx.status = 400;
    ctx.body = {
      code: 400,
      message: `channel must be one of ${SUPPORTED_LOGIN_CHANNELS.join(', ')}`,
    };
    return;
  }
  try {
    const key = await qrLoginService.createSession(channel);
    ctx.status = 200;
    ctx.body = { code: 200, data: { unikey: key } };
  } catch (error) {
    setServiceError(ctx, error);
  }
};

export const qrCreate = async (ctx: Context): Promise<void> => {
  const { key } = getTypedQuery<LoginQuery>(ctx);
  if (!key) {
    ctx.status = 400;
    ctx.body = { code: 400, message: 'key is required' };
    return;
  }
  try {
    const qrimg = await qrLoginService.createQr(String(key));
    ctx.status = 200;
    ctx.body = { code: 200, data: { qrimg } };
  } catch (error) {
    setServiceError(ctx, error);
  }
};

export const qrCheck = async (ctx: Context): Promise<void> => {
  const { key } = getTypedQuery<LoginQuery>(ctx);
  if (!key) {
    ctx.status = 400;
    ctx.body = { code: 400, message: 'key is required' };
    return;
  }
  const result = qrLoginService.checkQr(String(key));
  if (result.code === 803 && result.cookie) {
    const token = tokenFromCookieString(result.cookie);
    if (token)
      ctx.cookies.set(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        maxAge: 86400000,
        overwrite: true,
        sameSite: 'lax',
      });
  }
  ctx.status = 200;
  ctx.body = result;
};

export const loginStatus = async (ctx: Context): Promise<void> => {
  const profile = await qrLoginService.getLoginStatus(getAuthToken(ctx));
  ctx.status = 200;
  ctx.body = { code: 200, data: profile ? { profile } : {} };
};

export const userDetail = async (ctx: Context): Promise<void> => {
  const profile = await qrLoginService.getUserDetail(getAuthToken(ctx));
  ctx.status = profile ? 200 : 401;
  ctx.body = profile ? { code: 200, profile } : { code: 401, message: 'Login required' };
};

export const logout = (ctx: Context): void => {
  qrLoginService.logout(getAuthToken(ctx));
  ctx.cookies.set(AUTH_COOKIE_NAME, '', { expires: new Date(0), overwrite: true });
  ctx.status = 200;
  ctx.body = { code: 200 };
};
