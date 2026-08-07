import { logger } from '../../util/logger';
import type { AuthHttpClient } from './httpClient';
import type { QrEvent, QrEventListener } from './qrLogin';

// WeChat QR login channel (`tmeLoginType: 1`).
//
// This is the *web* OAuth flow: open.weixin.qq.com hands out a QR whose confirmation yields a
// WeChat OAuth `code`, which is then swapped for a QQ Music credential. It shares nothing with
// the QQ Music App channel (`tmeLoginType: 6`, MQTT over WSS) beyond that final musicu call,
// which stays in `qrLogin.ts` because it needs the Android device context that these endpoints
// must NOT receive.
//
// Endpoints, the appid and the status codes below are third-party reverse-engineered protocol
// facts taken from `L-1124/QQMusicApi` (`qqmusic_api/modules/login.py`,
// `qqmusic_api/models/login.py`, pinned commit 8ec78ce3f16805ebe470b8308a96fef925cf8e56).
// They are NOT official Tencent definitions. Unrecognised upstream numbers stay opaque safe
// codes and are never renamed into an official error meaning.
//
// This module must not import anything from `qrLogin.ts` at runtime (type-only imports are
// erased): `qrLogin.ts` imports this file, and a runtime cycle would break module init.

export const WECHAT_APP_ID = 'wx48db31d50e334801';
export const WECHAT_LOGIN_TYPE = 1;

const CONNECT_URL = 'https://open.weixin.qq.com/connect/qrconnect';
const IMAGE_URL_PREFIX = 'https://open.weixin.qq.com/connect/qrcode/';
const POLL_URL = 'https://lp.open.weixin.qq.com/connect/l/qrconnect';
const REDIRECT_URI = 'https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/';
const STYLE_HREF = 'https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect';
const POLL_REFERER = 'https://open.weixin.qq.com/';

const UUID_PATTERN = /uuid=(.+?)"/;
const STATUS_PATTERN = /window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/;

const PNG_MAGIC = '89504e470d0a1a0a';
const JPEG_MAGIC = 'ffd8ff';

const POLL_INTERVAL_MS = 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/**
 * `window.wx_errcode` values. The reference pairs each state with its QQ `ptuiCB` counterpart;
 * only the WeChat column is used here.
 */
export const WECHAT_STATUS = {
  waiting: 408,
  scanned: 404,
  confirmed: 405,
  expired: 402,
  refused: 403,
} as const;

export interface WechatQr {
  identifier: string;
  imageUrl: string;
}

export interface WechatQrStatus {
  upstreamCode: number;
  code: string;
}

export interface WechatQrListenerOptions {
  http: AuthHttpClient;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * A WeChat channel failure that still carries the upstream number as an opaque safe code.
 */
export class WechatQrError extends Error {
  public constructor(
    message: string,
    public readonly upstreamCode?: number,
  ) {
    super(message);
    this.name = 'WechatQrError';
  }
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

const bufferOf = (value: unknown): Buffer => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.alloc(0);
};

const imageMimetype = (image: Buffer): string | null => {
  const head = image.subarray(0, 8).toString('hex');
  if (head.startsWith(PNG_MAGIC)) return 'image/png';
  if (head.startsWith(JPEG_MAGIC)) return 'image/jpeg';
  return null;
};

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * Requests a WeChat QR and returns its `uuid` plus an inline data URL, so the transport keeps
 * handing the client a self-contained image exactly like the App channel does.
 */
export const createWechatQr = async (http: AuthHttpClient): Promise<WechatQr> => {
  const page = await http.request<string>({
    url: CONNECT_URL,
    method: 'GET',
    params: {
      appid: WECHAT_APP_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'snsapi_login',
      state: 'STATE',
      href: STYLE_HREF,
    },
    responseType: 'text',
  });
  const uuid = UUID_PATTERN.exec(textOf(page.data))?.[1] ?? '';
  if (!uuid) throw new WechatQrError('WeChat qrconnect response missing uuid');

  const image = await http.request<unknown>({
    url: `${IMAGE_URL_PREFIX}${uuid}`,
    method: 'GET',
    headers: { Referer: CONNECT_URL },
    responseType: 'arraybuffer',
  });
  const bytes = bufferOf(image.data);
  const mimetype = imageMimetype(bytes);
  if (!mimetype) throw new WechatQrError('WeChat QR response is not a PNG/JPEG image');

  logger.info('qq-auth.wechat-qr-created', {
    qrIdentifierLength: uuid.length,
    imageBytes: bytes.length,
    mimetype,
  });
  return { identifier: uuid, imageUrl: `data:${mimetype};base64,${bytes.toString('base64')}` };
};

/**
 * One long-poll of the WeChat QR state. The endpoint holds the connection open until the state
 * changes, so the caller does not need to poll aggressively.
 */
export const pollWechatQr = async (http: AuthHttpClient, uuid: string): Promise<WechatQrStatus> => {
  const response = await http.request<string>({
    url: POLL_URL,
    method: 'GET',
    params: { uuid, _: String(Date.now()) },
    headers: { Referer: POLL_REFERER },
    responseType: 'text',
  });
  const match = STATUS_PATTERN.exec(textOf(response.data));
  if (!match) throw new WechatQrError('WeChat poll response missing wx_errcode');
  return { upstreamCode: Number(match[1]), code: match[2] };
};

const eventForStatus = (status: WechatQrStatus): QrEvent => {
  switch (status.upstreamCode) {
    case WECHAT_STATUS.waiting:
      return { type: 'waiting', payload: null };
    case WECHAT_STATUS.scanned:
      return { type: 'scanned', payload: null };
    case WECHAT_STATUS.confirmed:
      return { type: 'authorized', payload: { code: status.code } };
    case WECHAT_STATUS.expired:
      return { type: 'timeout', payload: null };
    case WECHAT_STATUS.refused:
      return { type: 'canceled', payload: null };
    default:
      throw new WechatQrError('Unrecognised WeChat QR status', status.upstreamCode);
  }
};

const TERMINAL_EVENTS = new Set(['authorized', 'timeout', 'canceled']);

/**
 * Drives the WeChat QR to a terminal state, emitting the same event vocabulary the App channel
 * listener uses so the session state machine stays channel-agnostic.
 */
export const createWechatQrListener = (
  options: WechatQrListenerOptions,
  uuid: string,
  onEvent: (event: QrEvent) => void,
  timeoutMs: number,
): QrEventListener => {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  let stopped = false;

  const done = (async (): Promise<void> => {
    // Nothing has to be negotiated before the code is scannable, so the caller is released as
    // soon as the QR exists rather than after a long-poll round trip.
    onEvent({ type: 'waiting', payload: null });
    const deadline = now() + timeoutMs;
    let consecutiveErrors = 0;

    while (!stopped && now() < deadline) {
      let status: WechatQrStatus;
      try {
        status = await pollWechatQr(options.http, uuid);
        consecutiveErrors = 0;
      } catch (error) {
        // A dropped long-poll is normal; an unrecognised status code is not, and
        // `eventForStatus` throws that one outside this guard so it fails the session.
        consecutiveErrors += 1;
        if (consecutiveErrors > MAX_CONSECUTIVE_POLL_ERRORS) throw error;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (stopped) return;

      const event = eventForStatus(status);
      onEvent(event);
      if (TERMINAL_EVENTS.has(event.type ?? '')) return;
      await sleep(POLL_INTERVAL_MS);
    }
    if (!stopped) onEvent({ type: 'timeout', payload: null });
  })();

  void done.catch(() => undefined);
  return {
    ready: Promise.resolve(),
    done,
    close: () => {
      stopped = true;
    },
  };
};
