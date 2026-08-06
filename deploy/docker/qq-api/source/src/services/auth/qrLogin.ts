import crypto from 'node:crypto';
import { logger } from '../../util/logger';
import {
  type AndroidDevice,
  createDefaultDeviceContextRepository,
  createDeviceContextStore,
  type DeviceContextRepository,
  type DeviceContextStore,
} from './deviceContext';
import createAuthHttpClient, { type AuthHttpClient } from './httpClient';
import {
  createWechatQr,
  createWechatQrListener,
  WECHAT_APP_ID,
  WECHAT_LOGIN_TYPE,
  WechatQrError,
} from './wechatLogin';

const WebSocketRuntime = require('ws') as WebSocketConstructor;

const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QIMEI_URL = 'https://api.tencentmusic.com/tme/trpc/proxy';
// Public Android client protocol constants, not user credentials.
const QIMEI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDEIxgwoutfwoJxcGQeedgP7FG9qaIuS0qzfR8gWkrkTZKM2iWHn2ajQpBRZjMSoSf6+KJGvar2ORhBfpDXyVtZCKpqLQ+FLkpncClKVIrBwv6PHyUvuCb0rIarmgDnzkfQAqVufEtR64iazGDKatvJ9y6B9NMbHddGSAUmRTCrHQIDAQAB
-----END PUBLIC KEY-----`;
const QIMEI_SECRET = 'ZdJqM15EeO2zWc08';
const QIMEI_APP_KEY = '0AND0HD6FE4HY80F';
const CHANNEL_ID = '10003505';
const PACKAGE_ID = 'com.tencent.qqmusic';
const MQTT_HOST = 'mu.y.qq.com';
const MQTT_INITIAL_PATH = '/ws/handshake';
const QR_TTL_MS = 3 * 60 * 1000;
const AUTH_TTL_MS = 24 * 60 * 60 * 1000;
const QIMEI_TTL_MS = 24 * 60 * 60 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_MAX_MS = 15 * 60 * 1000;

type Dictionary = Record<string, unknown>;
/**
 * Login channels. `mobile` is the QQ Music App QR (MQTT over WSS, `tmeLoginType: 6`) and stays
 * the default so the public contract is unchanged for callers that do not ask for a channel.
 * `qq` is declared but not routable yet; `SUPPORTED_LOGIN_CHANNELS` is the authority.
 */
export type QrLoginChannel = 'mobile' | 'wechat' | 'qq';
export const DEFAULT_LOGIN_CHANNEL: QrLoginChannel = 'mobile';
export const SUPPORTED_LOGIN_CHANNELS: readonly QrLoginChannel[] = ['mobile', 'wechat'];

export const isSupportedLoginChannel = (value: unknown): value is QrLoginChannel =>
  SUPPORTED_LOGIN_CHANNELS.includes(value as QrLoginChannel);

type QrState =
  | 'created'
  | 'creating'
  | 'waiting'
  | 'scanned'
  | 'exchanging'
  | 'confirmed'
  | 'expired'
  | 'failed';

export interface QqCredential extends Dictionary {
  musicid: string | number;
  musickey: string;
  loginType: number;
}

export interface QrEvent {
  type: string | null;
  payload: unknown;
}

export interface QrEventListener {
  ready: Promise<void>;
  done: Promise<void>;
  close(): void;
}

interface QrSession {
  key: string;
  channel: QrLoginChannel;
  state: QrState;
  createdAt: number;
  expiresAt: number;
  /** Channel-agnostic QR handle: the App `qrcodeID`, or the WeChat `uuid`. */
  identifier?: string;
  /** App channel only; kept as-is because it is the `qrCodeID` exchange parameter. */
  qrcodeId?: string;
  imageUrl?: string;
  listener?: QrEventListener;
  /**
   * Web login channels hop across weixin.qq.com / qq.com carrying cookies. Sharing the musicu
   * jar would cross-contaminate both, so those channels get a client per QR session that dies
   * with the session. The App channel keeps using the shared client.
   */
  http?: AuthHttpClient;
  authToken?: string;
  upstreamCode?: number;
  retryAfterMs?: number;
}

interface AuthSession {
  token: string;
  credential: QqCredential;
  device: AndroidDevice;
  expiresAt: number;
}

interface QrLoginDependencies {
  http?: AuthHttpClient;
  /** Builds the per-QR-session client used by the web login channels. */
  createSessionHttp?: () => AuthHttpClient;
  deviceRepository?: DeviceContextRepository;
  listen?: (
    qrcodeId: string,
    onEvent: (event: QrEvent) => void,
    timeoutMs: number,
  ) => QrEventListener;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  randomBytes?: (size: number) => Buffer;
}

export interface QrCheckResult {
  code: 800 | 801 | 802 | 803;
  message: string;
  cookie?: string;
  upstreamCode?: number;
  retryAfterMs?: number;
}

export interface QrLoginService {
  createSession(channel?: QrLoginChannel): Promise<string>;
  createQr(key: string): Promise<string>;
  checkQr(key: string): QrCheckResult;
  getLoginStatus(token?: string): Promise<Dictionary | null>;
  getUserDetail(token?: string): Promise<Dictionary | null>;
  getUserPlaylists(token?: string, uin?: string): Promise<Dictionary | null>;
  getUserLikedSongs(token?: string, offset?: number, limit?: number): Promise<Dictionary | null>;
  getMusicPlay(
    token: string | undefined,
    songmid: string,
    quality?: string | number,
    mediaId?: string,
  ): Promise<Dictionary | null>;
  logout(token?: string): void;
}

interface WebSocketLike {
  readyState: number;
  on(event: string, listener: (...args: unknown[]) => void): WebSocketLike;
  once(event: string, listener: (...args: unknown[]) => void): WebSocketLike;
  removeListener(event: string, listener: (...args: unknown[]) => void): WebSocketLike;
  send(data: Buffer): void;
  close(): void;
}

interface WebSocketConstructor {
  new (url: string, protocol: string): WebSocketLike;
}

interface PacketQueue {
  next(timeoutMs: number): Promise<Buffer>;
}

export class QrLoginServiceError extends Error {
  public constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly retryAfterMs?: number,
    public readonly upstreamCode?: number,
  ) {
    super(message);
    this.name = 'QrLoginServiceError';
  }
}

/**
 * QIMEI bootstrap rejection. Only the upstream numeric codes are carried; they are opaque
 * security codes and must never be renamed into an official error meaning.
 */
export class QqDeviceBootstrapError extends Error {
  public constructor(
    public readonly httpStatus: number,
    public readonly outerCode: number | undefined,
    public readonly innerCode: number | undefined,
  ) {
    super(
      `QIMEI bootstrap failed (HTTP ${httpStatus}, outer=${outerCode ?? 'unknown'}, inner=${innerCode ?? 'unknown'})`,
    );
    this.name = 'QqDeviceBootstrapError';
  }
}

export class QqProtocolError extends Error {
  public constructor(
    public readonly phase: string,
    public readonly upstreamCode: number | undefined,
    public readonly globalCode: number,
    public readonly httpStatus: number,
  ) {
    super(
      `${phase} failed (HTTP ${httpStatus}, global=${globalCode}, code=${upstreamCode ?? 'unknown'})`,
    );
    this.name = 'QqProtocolError';
  }
}

const isDictionary = (value: unknown): value is Dictionary =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const dictionaryOf = (value: unknown): Dictionary => (isDictionary(value) ? value : {});

const stringOf = (value: unknown): string => (typeof value === 'string' ? value : '');
const identifierOf = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const credentialMusicId = (credential: QqCredential): string => {
  const stringId = identifierOf(credential.str_musicid).trim();
  const rawId = identifierOf(credential.musicid).trim();
  return (
    (stringId && stringId !== '0' ? stringId : '') ||
    (rawId && rawId !== '0' ? rawId : '') ||
    stringId ||
    rawId
  );
};

const numberOf = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * `music.vkey.GetVkey/UrlGetVkey` answers with `midurlinfo` but an empty `sip`, unlike the legacy
 * web `CgiGetVkey`. Without a fallback the play URL degrades into a bare filename, which the
 * browser then resolves against its own origin. Measured 2026-08-06 against a real vkey: only
 * `dl.stream` serves it (HTTP 206 `audio/mpeg`); `isure.stream` and `ws.stream` answer 403.
 */
const DEFAULT_STREAM_DOMAIN = 'http://dl.stream.qqmusic.qq.com/';

const MUSIC_FILE_TYPES = {
  m4a: { prefix: 'C400', extension: '.m4a' },
  128: { prefix: 'M500', extension: '.mp3' },
  320: { prefix: 'M800', extension: '.mp3' },
  ape: { prefix: 'A000', extension: '.ape' },
  flac: { prefix: 'F000', extension: '.flac' },
} as const;

const getAuthenticatedPlayUrls = async (
  http: AuthHttpClient,
  auth: AuthSession,
  songmid: string,
  quality: string | number = 128,
  mediaId?: string,
): Promise<Dictionary> => {
  const songmidList = songmid
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const qualityKey = String(quality) as keyof typeof MUSIC_FILE_TYPES;
  const fileType = MUSIC_FILE_TYPES[qualityKey] ?? MUSIC_FILE_TYPES[128];
  const guid = crypto.randomUUID().replaceAll('-', '');
  const normalizedMediaId = stringOf(mediaId).trim();
  const data = await callMusicu(
    http,
    auth.device,
    'get-music-play',
    'music.vkey.GetVkey',
    'UrlGetVkey',
    {
      // filename 一律是两段识别值：`prefix + songmid + media_mid + extension`。media_mid 缺席时
      // 用 songmid 补上第二段；只送一段的文件名在 vkey server 仍会拿到 purl，但 CDN 端会 403。
      filename: songmidList.map(
        (mid) => `${fileType.prefix}${mid}${normalizedMediaId || mid}${fileType.extension}`,
      ),
      guid,
      songmid: songmidList,
      songtype: songmidList.map(() => 0),
      uin: stringOf(auth.credential.str_musicid) || String(auth.credential.musicid),
      ctx: 0,
    },
    auth.credential,
  );
  const sip = Array.isArray(data.sip) ? data.sip.map(stringOf).filter(Boolean) : [];
  const domain =
    sip.find((value) => !value.startsWith('http://ws')) ?? sip[0] ?? DEFAULT_STREAM_DOMAIN;
  const playUrl: Dictionary = {};
  const entries = Array.isArray(data.midurlinfo) ? data.midurlinfo : [];
  for (const entry of entries) {
    const item = dictionaryOf(entry);
    const mid = identifierOf(item.songmid);
    if (!mid) continue;
    const purl = stringOf(item.purl);
    playUrl[mid] = {
      url: purl ? `${domain}${purl}` : '',
      error: purl ? false : '暂无播放链接',
    };
  }
  return playUrl;
};

const parseDictionary = (value: unknown): Dictionary => {
  if (isDictionary(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    return dictionaryOf(JSON.parse(value));
  } catch {
    return {};
  }
};

const md5 = (...values: string[]): string => {
  const hash = crypto.createHash('md5');
  for (const value of values) hash.update(value);
  return hash.digest('hex');
};

const randomHex = (length: number): string =>
  crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);

const randomDigits = (length: number): string => {
  let value = '';
  for (let index = 0; index < length; index += 1) value += crypto.randomInt(0, 10);
  return value;
};

const randomBeaconId = (now = new Date()): string => {
  const month = `${now.toISOString().slice(0, 7)}-01`;
  const first = randomDigits(6);
  const second = randomDigits(9);
  const dated = new Set([1, 2, 13, 14, 17, 18, 21, 22, 25, 26, 29, 30, 33, 34, 37, 38]);
  const fields: string[] = [];
  for (let key = 1; key <= 40; key += 1) {
    if (dated.has(key)) fields.push(`k${key}:${month}${first}.${second}`);
    else if (key === 3) fields.push('k3:0000000000000000');
    else if (key === 4) fields.push(`k4:${randomHex(16).replaceAll('0', '1')}`);
    else fields.push(`k${key}:${crypto.randomInt(0, 10000)}`);
  }
  return `${fields.join(';')};`;
};

const buildQimeiPayload = (device: AndroidDevice, now = new Date()): Dictionary => {
  const uptime = new Date(now.getTime() - crypto.randomInt(0, 14401) * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  const reserved = {
    harmony: '0',
    clone: '0',
    containe: '',
    oz: 'UhYmelwouA+V2nPWbOvLTgN2/m8jwGB+yUB5v9tysQg=',
    oo: 'Xecjt+9S1+f8Pz2VLSxgpw==',
    kelong: '0',
    uptimes: uptime,
    multiUser: '0',
    bod: device.brand,
    dv: device.device,
    firstLevel: '',
    manufact: device.brand,
    name: device.model,
    host: 'se.infra',
    kernel: device.procVersion,
  };
  return {
    androidId: device.androidId,
    platformId: 1,
    appKey: QIMEI_APP_KEY,
    appVersion: '14.9.0.8',
    beaconIdSrc: randomBeaconId(now),
    brand: device.brand,
    channelId: CHANNEL_ID,
    cid: '',
    imei: device.imei,
    imsi: '',
    mac: '',
    model: device.model,
    networkType: 'unknown',
    oaid: '',
    osVersion: `Android ${device.osRelease},level ${device.sdk}`,
    qimei: '',
    qimei36: '',
    sdkVersion: '1.2.13.6',
    targetSdkVersion: '33',
    audit: '',
    userId: '{}',
    packageId: PACKAGE_ID,
    deviceType: 'Phone',
    sdkName: '',
    reserved: JSON.stringify(reserved),
  };
};

export const buildQimeiRequest = (device: AndroidDevice, now = new Date()): Dictionary => {
  const cryptKey = randomHex(16);
  const nonce = randomHex(16);
  const timestamp = Math.floor(now.getTime() / 1000);
  const encryptedKey = crypto.publicEncrypt(
    { key: QIMEI_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(cryptKey),
  );
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(cryptKey), Buffer.from(cryptKey));
  const encryptedPayload = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(buildQimeiPayload(device, now)))),
    cipher.final(),
  ]);
  const key = encryptedKey.toString('base64');
  const params = encryptedPayload.toString('base64');
  const extra = `{"appKey":"${QIMEI_APP_KEY}"}`;
  return {
    headers: {
      Host: 'api.tencentmusic.com',
      method: 'GetQimei',
      service: 'trpc.tme_datasvr.qimeiproxy.QimeiProxy',
      appid: 'qimei_qq_android',
      sign: md5('qimei_qq_androidpzAuCmaFAaFaHrdakPjLIEqKrGnSOOvH', String(timestamp)),
      'user-agent': 'QQMusic',
      timestamp: String(timestamp),
    },
    body: {
      app: 0,
      os: 1,
      qimeiParams: {
        key,
        params,
        time: String(timestamp),
        nonce,
        sign: md5(key, params, String(timestamp * 1000), nonce, QIMEI_SECRET, extra),
        extra,
      },
    },
  };
};

export const buildAndroidComm = (
  device: AndroidDevice,
  credential?: QqCredential,
  overrides: Dictionary = {},
): Dictionary => ({
  ct: 11,
  cv: 14090008,
  v: 14090008,
  chid: CHANNEL_ID,
  tmeAppID: 'qqmusic',
  QIMEI: device.qimei ?? '',
  QIMEI36: device.qimei36 ?? '',
  OpenUDID: device.openUdid,
  udid: device.openUdid,
  OpenUDID2: device.openUdid,
  aid: device.androidId,
  os_ver: device.osRelease,
  phonetype: device.model,
  devicelevel: String(device.sdk),
  newdevicelevel: String(device.sdk),
  rom: device.fingerprint,
  ...(device.sessionUid ? { uid: device.sessionUid } : {}),
  ...(device.sessionSid ? { sid: device.sessionSid } : {}),
  ...(credential
    ? {
        qq: credentialMusicId(credential),
        authst: credential.musickey,
        tmeLoginType: credential.loginType,
      }
    : {}),
  ...overrides,
});

const encodeVariableInteger = (input: number): Buffer => {
  let value = input;
  const bytes: number[] = [];
  do {
    let digit = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) digit |= 0x80;
    bytes.push(digit);
  } while (value > 0);
  return Buffer.from(bytes);
};

const decodeVariableInteger = (
  buffer: Buffer,
  offset = 0,
): { value: number; bytes: number } | null => {
  let multiplier = 1;
  let value = 0;
  for (let bytes = 0; bytes < 4; bytes += 1) {
    if (offset + bytes >= buffer.length) return null;
    const digit = buffer[offset + bytes];
    value += (digit & 0x7f) * multiplier;
    if ((digit & 0x80) === 0) return { value, bytes: bytes + 1 };
    multiplier *= 128;
  }
  throw new Error('Malformed MQTT variable integer');
};

const encodeUtf8 = (value: string): Buffer => {
  const data = Buffer.from(value, 'utf8');
  const size = Buffer.allocUnsafe(2);
  size.writeUInt16BE(data.length);
  return Buffer.concat([size, data]);
};

const encodeProperties = (
  authMethod: string | null,
  properties: Array<[string, string]>,
): Buffer => {
  const chunks: Buffer[] = [];
  if (authMethod) chunks.push(Buffer.from([0x15]), encodeUtf8(authMethod));
  for (const [key, value] of properties)
    chunks.push(Buffer.from([0x26]), encodeUtf8(key), encodeUtf8(value));
  const data = Buffer.concat(chunks);
  return Buffer.concat([encodeVariableInteger(data.length), data]);
};

const wrapPacket = (header: number, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from([header]), encodeVariableInteger(body.length), body]);

const buildConnectPacket = (clientId: string, qrcodeId: string): Buffer => {
  const keepAlive = Buffer.allocUnsafe(2);
  keepAlive.writeUInt16BE(45);
  const properties = encodeProperties('pass', [
    ['tmeAppID', 'qqmusic'],
    ['business', 'management'],
    ['hashTag', qrcodeId],
    ['clientTag', 'management.user'],
    ['userID', qrcodeId],
  ]);
  return wrapPacket(
    0x10,
    Buffer.concat([
      encodeUtf8('MQTT'),
      Buffer.from([0x05, 0x02]),
      keepAlive,
      properties,
      encodeUtf8(clientId),
    ]),
  );
};

const buildSubscribePacket = (qrcodeId: string): Buffer => {
  const packetId = Buffer.from([0x00, 0x01]);
  const properties = encodeProperties(null, [
    ['authorization', 'tmelogin'],
    ['pubsub', 'unicast'],
  ]);
  return wrapPacket(
    0x82,
    Buffer.concat([
      packetId,
      properties,
      encodeUtf8(`management.qrcode_login/${qrcodeId}`),
      Buffer.from([0x00]),
    ]),
  );
};

const readUtf8 = (buffer: Buffer, offset: number): { value: string; next: number } => {
  const length = buffer.readUInt16BE(offset);
  const start = offset + 2;
  return { value: buffer.subarray(start, start + length).toString('utf8'), next: start + length };
};

const skipProperty = (buffer: Buffer, offset: number, id: number): number => {
  if ([0x03, 0x08, 0x12, 0x15, 0x1a, 0x1c, 0x1f].includes(id)) return readUtf8(buffer, offset).next;
  if ([0x13, 0x21, 0x22, 0x23].includes(id)) return offset + 2;
  if ([0x02, 0x11, 0x18, 0x27].includes(id)) return offset + 4;
  if ([0x01, 0x17, 0x19, 0x24, 0x25, 0x28, 0x29, 0x2a].includes(id)) return offset + 1;
  if ([0x09, 0x16].includes(id)) return offset + 2 + buffer.readUInt16BE(offset);
  if (id === 0x0b) {
    const value = decodeVariableInteger(buffer, offset);
    if (!value) throw new Error('Truncated MQTT subscription identifier');
    return offset + value.bytes;
  }
  throw new Error(`Unsupported MQTT property 0x${id.toString(16)}`);
};

const parseProperties = (buffer: Buffer, offset: number): { values: Dictionary; next: number } => {
  const length = decodeVariableInteger(buffer, offset);
  if (!length) throw new Error('Truncated MQTT properties');
  let cursor = offset + length.bytes;
  const end = cursor + length.value;
  const userProperties: Dictionary = {};
  const values: Dictionary = { userProperties };
  while (cursor < end) {
    const id = buffer[cursor];
    cursor += 1;
    if (id === 0x26) {
      const key = readUtf8(buffer, cursor);
      const value = readUtf8(buffer, key.next);
      userProperties[key.value] = value.value;
      cursor = value.next;
    } else if (id === 0x1c || id === 0x1f) {
      const value = readUtf8(buffer, cursor);
      values[id === 0x1c ? 'serverReference' : 'reasonString'] = value.value;
      cursor = value.next;
    } else cursor = skipProperty(buffer, cursor, id);
  }
  return { values, next: end };
};

const splitPackets = (buffer: Buffer): { packets: Buffer[]; rest: Buffer } => {
  const packets: Buffer[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const remaining = decodeVariableInteger(buffer, cursor + 1);
    if (!remaining) break;
    const end = cursor + 1 + remaining.bytes + remaining.value;
    if (end > buffer.length) break;
    packets.push(buffer.subarray(cursor, end));
    cursor = end;
  }
  return { packets, rest: buffer.subarray(cursor) };
};

const parseConnack = (packet: Buffer): Dictionary => {
  const remaining = decodeVariableInteger(packet, 1);
  if (!remaining) throw new Error('Truncated MQTT CONNACK');
  const offset = 1 + remaining.bytes;
  return { reasonCode: packet[offset + 1], ...parseProperties(packet, offset + 2).values };
};

const parsePublish = (packet: Buffer): QrEvent => {
  const remaining = decodeVariableInteger(packet, 1);
  if (!remaining) throw new Error('Truncated MQTT PUBLISH');
  let cursor = 1 + remaining.bytes;
  cursor = readUtf8(packet, cursor).next;
  if (((packet[0] >> 1) & 0x03) > 0) cursor += 2;
  const properties = parseProperties(packet, cursor);
  const users = dictionaryOf(properties.values.userProperties);
  const raw = packet.subarray(properties.next).toString('utf8');
  return { type: stringOf(users.type) || null, payload: raw ? parseDictionary(raw) : null };
};

const toBuffer = (value: unknown): Buffer => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every(Buffer.isBuffer)) return Buffer.concat(value);
  throw new Error('Unsupported MQTT WebSocket payload');
};

const createPacketQueue = (socket: WebSocketLike): PacketQueue => {
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const packets: Buffer[] = [];
  const waiters: Array<{ resolve: (packet: Buffer) => void; reject: (error: Error) => void }> = [];
  let terminalError: Error | null = null;
  const settle = (): void => {
    while (waiters.length && packets.length) waiters.shift()?.resolve(packets.shift() as Buffer);
    while (terminalError && waiters.length) waiters.shift()?.reject(terminalError);
  };
  socket.on('message', (value) => {
    const split = splitPackets(Buffer.concat([buffered, toBuffer(value)]));
    buffered = split.rest;
    packets.push(...split.packets);
    settle();
  });
  socket.on('error', () => {
    terminalError = new Error('MQTT WebSocket error');
    settle();
  });
  socket.on('close', () => {
    terminalError = new Error('MQTT WebSocket closed');
    settle();
  });
  return {
    next(timeoutMs: number): Promise<Buffer> {
      if (packets.length) return Promise.resolve(packets.shift() as Buffer);
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        waiters.push(waiter);
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('MQTT packet timeout'));
        }, timeoutMs);
        waiter.resolve = (packet) => {
          clearTimeout(timer);
          resolve(packet);
        };
        waiter.reject = (error) => {
          clearTimeout(timer);
          reject(error);
        };
      });
    },
  };
};

const openWebSocket = (path: string): Promise<WebSocketLike> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocketRuntime(`wss://${MQTT_HOST}${path}`, 'mqtt');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('MQTT handshake timeout'));
    }, 20000);
    const onOpen = (): void => {
      clearTimeout(timer);
      socket.removeListener('error', onError);
      resolve(socket);
    };
    const onError = (): void => {
      clearTimeout(timer);
      socket.removeListener('open', onOpen);
      reject(new Error('MQTT handshake failed'));
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  });

const redirectPath = (path: string, reference: string): string => {
  const parts = path.replace(/\/$/, '').split('/');
  if (parts.at(-1)?.includes(':')) parts[parts.length - 1] = reference;
  else parts.push(reference);
  return parts.join('/');
};

const connectMqtt = async (qrcodeId: string) => {
  let path = MQTT_INITIAL_PATH;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const socket = await openWebSocket(path);
    const queue = createPacketQueue(socket);
    socket.send(buildConnectPacket(`${Date.now()}${randomDigits(4)}`, qrcodeId));
    const connack = parseConnack(await queue.next(20000));
    const reasonCode = numberOf(connack.reasonCode) ?? -1;
    if (reasonCode === 0) return { socket, queue };
    socket.close();
    const reference = stringOf(connack.serverReference);
    if (![0x9c, 0x9d].includes(reasonCode) || !reference || redirects === 3) {
      throw new Error(`MQTT CONNACK rejected: 0x${reasonCode.toString(16)}`);
    }
    path = redirectPath(path, reference);
  }
  throw new Error('MQTT redirect limit exceeded');
};

const subscribeToQrEvents = async (
  socket: WebSocketLike,
  queue: PacketQueue,
  qrcodeId: string,
  onEvent: (event: QrEvent) => void,
): Promise<void> => {
  socket.send(buildSubscribePacket(qrcodeId));
  while (true) {
    const packet = await queue.next(20000);
    if (packet[0] >> 4 === 9) {
      const reasonCode = packet.at(-1) ?? 0x80;
      if (reasonCode >= 0x80) throw new Error(`MQTT SUBACK rejected: 0x${reasonCode.toString(16)}`);
      return;
    }
    if (packet[0] >> 4 === 3) onEvent(parsePublish(packet));
  }
};

const consumeQrEvents = async (
  queue: PacketQueue,
  onEvent: (event: QrEvent) => void,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const packet = await queue.next(Math.max(1, deadline - Date.now()));
    if (packet[0] >> 4 !== 3) continue;
    const event = parsePublish(packet);
    onEvent(event);
    if (['cookies', 'canceled', 'timeout', 'loginFailed'].includes(event.type ?? '')) return;
  }
  onEvent({ type: 'timeout', payload: null });
};

const defaultListen = (
  qrcodeId: string,
  onEvent: (event: QrEvent) => void,
  timeoutMs: number,
): QrEventListener => {
  let activeSocket: WebSocketLike | null = null;
  let readySettled = false;
  let resolveReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const done = (async (): Promise<void> => {
    const { socket, queue } = await connectMqtt(qrcodeId);
    activeSocket = socket;
    const ping = setInterval(() => {
      if (socket.readyState === 1) socket.send(Buffer.from([0xc0, 0x00]));
    }, 30000);
    try {
      await subscribeToQrEvents(socket, queue, qrcodeId, onEvent);
      onEvent({ type: 'waiting', payload: null });
      readySettled = true;
      resolveReady();
      await consumeQrEvents(queue, onEvent, timeoutMs);
    } catch (error) {
      if (!readySettled) rejectReady(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      clearInterval(ping);
      socket.close();
    }
  })();
  void done.catch(() => undefined);
  return { ready, done, close: () => activeSocket?.close() };
};

const buildQimeiHeadersAndBody = (
  device: AndroidDevice,
): { headers: Record<string, string>; body: Dictionary } => {
  const request = buildQimeiRequest(device);
  const rawHeaders = dictionaryOf(request.headers);
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  return { headers, body: dictionaryOf(request.body) };
};

/**
 * Reuses the stored QIMEI while it is fresh and returns whether the device context changed.
 * Diagnostics stay at code/type/length granularity: raw bodies and identifiers never leave
 * this function.
 */
const ensureQimei = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  now: number,
): Promise<boolean> => {
  const fresh =
    device.qimei &&
    device.qimei36 &&
    device.qimeiSavedAt &&
    now - device.qimeiSavedAt < QIMEI_TTL_MS;
  if (fresh) {
    logger.info('qq-auth.qimei-result', { source: 'cache' });
    return false;
  }
  const request = buildQimeiHeadersAndBody(device);
  const response = await http.post<unknown>(QIMEI_URL, request.body, { headers: request.headers });
  const outer = parseDictionary(response.data);
  const inner = parseDictionary(outer.data);
  const data = dictionaryOf(inner.data);
  const qimei = stringOf(data.q16);
  const qimei36 = stringOf(data.q36);
  const outerCode = numberOf(outer.code);
  const innerCode = numberOf(inner.code);
  logger.info('qq-auth.qimei-result', {
    source: 'upstream',
    httpStatus: response.status,
    outerCode,
    outerDataType: typeof outer.data,
    innerCode,
    q16Length: qimei.length,
    q36Length: qimei36.length,
  });
  if (!qimei || !qimei36) throw new QqDeviceBootstrapError(response.status, outerCode, innerCode);
  device.qimei = qimei;
  device.qimei36 = qimei36;
  device.qimeiSavedAt = now;
  return true;
};

const callMusicu = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  phase: string,
  module: string,
  method: string,
  param: Dictionary,
  credential?: QqCredential,
  overrides: Dictionary = {},
): Promise<Dictionary> => {
  const musicid = credential
    ? identifierOf(credential.str_musicid) || String(credential.musicid)
    : '';
  const credentialCookies = credential
    ? [
        `uin=${musicid}`,
        `qqmusic_uin=${musicid}`,
        `qm_keyst=${credential.musickey}`,
        `qqmusic_key=${credential.musickey}`,
      ].join('; ')
    : '';
  const response = await http.post<unknown>(
    MUSICU_URL,
    {
      comm: buildAndroidComm(device, credential, overrides),
      req_0: { module, method, param },
    },
    {
      headers: {
        'User-Agent': `QQMusic 14090008(android ${device.osRelease})`,
        ...(credentialCookies ? { Cookie: credentialCookies } : {}),
      },
    },
  );
  const body = dictionaryOf(response.data);
  const item = dictionaryOf(body.req_0);
  const globalCode = numberOf(body.code) ?? 0;
  const upstreamCode = numberOf(item.code);
  logger.info('qq-auth.upstream-result', {
    phase,
    httpStatus: response.status,
    globalCode,
    upstreamCode,
  });
  if (!Object.keys(item).length || globalCode !== 0 || (upstreamCode ?? 0) !== 0) {
    throw new QqProtocolError(phase, upstreamCode, globalCode, response.status);
  }
  return dictionaryOf(item.data);
};

const refreshAndroidSession = async (
  http: AuthHttpClient,
  device: AndroidDevice,
): Promise<void> => {
  const data = await callMusicu(
    http,
    device,
    'get-session',
    'music.getSession.session',
    'GetSession',
    {
      uid: device.sessionUid ?? '',
      vkey: 0,
      caller: 0,
    },
  );
  const session = dictionaryOf(data.session);
  const uid = identifierOf(session.uid);
  const sid = identifierOf(session.sid);
  if (!uid || !sid) throw new Error('GetSession response missing uid/sid');
  device.sessionUid = uid;
  device.sessionSid = sid;
  device.sessionVkey = session.vkey;
};

const createNativeQr = async (http: AuthHttpClient, device: AndroidDevice) => {
  const data = await callMusicu(
    http,
    device,
    'create-qr',
    'music.login.LoginServer',
    'CreateQRCode',
    {
      tmeAppID: 'qqmusic',
      ct: 11,
      cv: 14090008,
    },
    undefined,
    { ct: 23, cv: 0 },
  );
  const qrcodeId = stringOf(data.qrcodeID);
  const encoded = stringOf(data.qrcode).split(',').at(-1) ?? '';
  const image = Buffer.from(encoded, 'base64');
  if (!qrcodeId || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('CreateQRCode response missing a valid PNG/qrcodeID');
  }
  return {
    qrcodeId,
    imageUrl: `data:image/png;base64,${image.toString('base64')}`,
    expiresIn: numberOf(data.expiresIn),
  };
};

const MOBILE_LOGIN_TYPE = 6;

const credentialFrom = (value: Dictionary, defaultLoginType: number): QqCredential => {
  const musicid = value.musicid ?? value.str_musicid;
  const musickey = stringOf(value.musickey);
  if ((!stringOf(musicid) && typeof musicid !== 'number') || !musickey)
    throw new Error('Login response missing credential');
  return {
    ...value,
    musicid: musicid as string | number,
    musickey,
    // The channel that produced the credential is the fallback, never a fixed 6: a WeChat
    // credential sent back with `tmeLoginType: 6` would be rejected on every later request.
    loginType: numberOf(value.loginType) ?? defaultLoginType,
  };
};

const PRIVATE_RESPONSE_KEYS = new Set([
  'musickey',
  'authst',
  'qqmusic_key',
  'token',
  'qimei',
  'qimei36',
  'sid',
  'vkey',
]);

const sanitizePublicValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (!isDictionary(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_RESPONSE_KEYS.has(key.toLowerCase()))
      .map(([key, item]) => [key, sanitizePublicValue(item)]),
  );
};

const exchangeCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  qrcodeId: string,
  musicid: string,
  token: string,
): Promise<QqCredential> =>
  credentialFrom(
    await callMusicu(
      http,
      device,
      'credential-exchange',
      'music.login.LoginServer',
      'Login',
      { musicid: Number(musicid), qrCodeID: qrcodeId, token },
      undefined,
      { tmeLoginType: MOBILE_LOGIN_TYPE },
    ),
    MOBILE_LOGIN_TYPE,
  );

/**
 * WeChat channel exchange: the OAuth `code` from the web flow, not an MQTT token. It runs on
 * the shared device-bound client because it is a musicu call and needs the Android comm; the
 * WeChat endpoints themselves never see that device context.
 */
const exchangeWechatCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  code: string,
): Promise<QqCredential> =>
  credentialFrom(
    await callMusicu(
      http,
      device,
      'credential-exchange',
      'music.login.LoginServer',
      'Login',
      { code, strAppid: WECHAT_APP_ID },
      undefined,
      { tmeLoginType: WECHAT_LOGIN_TYPE },
    ),
    WECHAT_LOGIN_TYPE,
  );

// QQMusicApi v0.6.6 treats these upstream numeric results as a signal to try the
// channel-specific credential refresh. They remain opaque safety codes here.
const CREDENTIAL_REFRESH_SAFETY_CODES = new Set([1000, 104401, 104400]);

const getLoginUserWithCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  credential: QqCredential,
): Promise<Dictionary> =>
  dictionaryOf(
    sanitizePublicValue(
      await callMusicu(
        http,
        device,
        'get-login-user',
        'music.UserInfo.userInfoServer',
        'GetLoginUserInfo',
        {},
        credential,
      ),
    ),
  );

const getLoginUser = async (http: AuthHttpClient, auth: AuthSession): Promise<Dictionary> =>
  getLoginUserWithCredential(http, auth.device, auth.credential);

/** Builds the same public profile shape from the non-secret identity fields in a credential. */
const publicProfileFromCredential = (credential: QqCredential): Dictionary => {
  const strMusicId = stringOf(credential.str_musicid);
  const nickname = stringOf(credential.nick) || stringOf(credential.nickname);
  const avatarUrl = stringOf(credential.logo) || stringOf(credential.avatarUrl);
  return {
    musicid: credential.musicid,
    ...(strMusicId ? { str_musicid: strMusicId } : {}),
    ...(nickname ? { nickname, nick: nickname } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
};

const getLoginProfile = async (http: AuthHttpClient, auth: AuthSession): Promise<Dictionary> => {
  try {
    return await getLoginUser(http, auth);
  } catch (error) {
    if (
      auth.credential.loginType !== WECHAT_LOGIN_TYPE ||
      !(error instanceof QqProtocolError) ||
      error.upstreamCode === undefined ||
      !CREDENTIAL_REFRESH_SAFETY_CODES.has(error.upstreamCode)
    )
      throw error;
    return publicProfileFromCredential(auth.credential);
  }
};

/** Refreshes a WeChat credential with the complete field set returned by its QR exchange. */
const refreshWechatCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  credential: QqCredential,
): Promise<QqCredential> =>
  credentialFrom(
    await callMusicu(
      http,
      device,
      'credential-refresh',
      'music.login.LoginServer',
      'Login',
      {
        openid: stringOf(credential.openid),
        refresh_token: stringOf(credential.refresh_token),
        str_musicid: stringOf(credential.str_musicid) || String(credential.musicid),
        musickey: credential.musickey,
        unionid: stringOf(credential.unionid),
        refresh_key: stringOf(credential.refresh_key),
        loginMode: 2,
      },
      credential,
      { tmeLoginType: WECHAT_LOGIN_TYPE },
    ),
    WECHAT_LOGIN_TYPE,
  );

/** Refreshes the exchanged WeChat key once when the reference credential check requests it. */
const validateWechatCredential = async (
  http: AuthHttpClient,
  device: AndroidDevice,
  credential: QqCredential,
): Promise<QqCredential> => {
  try {
    await getLoginUserWithCredential(http, device, credential);
    return credential;
  } catch (error) {
    if (
      !(error instanceof QqProtocolError) ||
      error.upstreamCode === undefined ||
      !CREDENTIAL_REFRESH_SAFETY_CODES.has(error.upstreamCode)
    )
      throw error;
  }

  const refreshed = await refreshWechatCredential(http, device, credential);
  logger.info('qq-auth.credential-refreshed', {
    loginChannel: 'wechat',
    credentialLoginType: refreshed.loginType,
    credentialKeys: Object.keys(refreshed).sort(),
    credentialKeyLength: refreshed.musickey.length,
  });
  return refreshed;
};

const getPlaylists = async (
  http: AuthHttpClient,
  auth: AuthSession,
  uin?: string,
): Promise<Dictionary> => {
  const created = await callMusicu(
    http,
    auth.device,
    'get-user-playlists',
    'music.musicasset.PlaylistBaseRead',
    'GetPlaylistByUin',
    { uin: uin || credentialMusicId(auth.credential) },
    auth.credential,
  );
  const createdPlaylists = Array.isArray(created.v_playlist) ? created.v_playlist : [];
  const favoritePlaylists: unknown[] = [];
  const encryptedUin = stringOf(auth.credential.encryptUin);

  if (encryptedUin) {
    const pageSize = 100;
    let offset = 0;
    while (offset < 1000) {
      const favoritePage = await callMusicu(
        http,
        auth.device,
        'get-user-favorite-playlists',
        'music.musicasset.PlaylistFavRead',
        'CgiGetPlaylistFavInfo',
        { uin: encryptedUin, offset, size: pageSize },
        auth.credential,
      );
      const pageItems = Array.isArray(favoritePage.v_list) ? favoritePage.v_list : [];
      favoritePlaylists.push(...pageItems);
      offset += pageItems.length;
      if (
        pageItems.length === 0 ||
        (favoritePage.hasmore !== true && numberOf(favoritePage.hasmore) !== 1)
      )
        break;
    }
  }

  const seen = new Set<string>();
  const playlists = [...createdPlaylists, ...favoritePlaylists].filter((value) => {
    const item = dictionaryOf(value);
    const id = identifierOf(item.tid ?? item.dissid ?? item.id ?? item.dirId ?? item.dirid);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return dictionaryOf(
    sanitizePublicValue({
      ...created,
      v_playlist: playlists,
      total: playlists.length,
      bFinish: true,
    }),
  );
};

const getLikedSongs = async (
  http: AuthHttpClient,
  auth: AuthSession,
  offset = 0,
  limit = 100,
): Promise<Dictionary> => {
  const encryptedUin = stringOf(auth.credential.encryptUin);
  if (!encryptedUin) throw new Error('Login credential is missing encryptUin');
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  return dictionaryOf(
    sanitizePublicValue(
      await callMusicu(
        http,
        auth.device,
        'get-user-liked-songs',
        'music.srfDissInfo.DissInfo',
        'CgiGetDiss',
        {
          disstid: 0,
          dirid: 201,
          tag: true,
          song_begin: safeOffset,
          song_num: safeLimit,
          userinfo: true,
          orderlist: true,
          enc_host_uin: encryptedUin,
        },
        auth.credential,
      ),
    ),
  );
};

const terminalState = (state: QrState): boolean =>
  ['confirmed', 'expired', 'failed'].includes(state);

/** Keeps whatever opaque number the upstream gave us, whichever channel produced the failure. */
const upstreamCodeOf = (error: unknown): number | undefined => {
  if (error instanceof QqProtocolError) return error.upstreamCode;
  if (error instanceof WechatQrError) return error.upstreamCode;
  return undefined;
};

type QrListenerFactory = (
  qrcodeId: string,
  onEvent: (event: QrEvent) => void,
  timeoutMs: number,
) => QrEventListener;

class QrLoginServiceImpl implements QrLoginService {
  private readonly http: AuthHttpClient;
  private readonly createSessionHttp: () => AuthHttpClient;
  private readonly listen: QrListenerFactory;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: (size: number) => Buffer;
  private readonly qrSessions = new Map<string, QrSession>();
  private readonly authSessions = new Map<string, AuthSession>();
  private readonly deviceStore: DeviceContextStore;
  private creatingSession = false;
  private failureCount = 0;
  private nextQrAllowedAt = 0;

  public constructor(dependencies: QrLoginDependencies) {
    this.http = dependencies.http ?? createAuthHttpClient();
    this.createSessionHttp = dependencies.createSessionHttp ?? createAuthHttpClient;
    this.listen = dependencies.listen ?? defaultListen;
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = dependencies.randomBytes ?? crypto.randomBytes;
    this.deviceStore = createDeviceContextStore(
      dependencies.deviceRepository ?? createDefaultDeviceContextRepository(),
    );
  }

  private cleanup(): void {
    const current = this.now();
    for (const [key, session] of this.qrSessions) {
      if (session.expiresAt <= current) {
        session.listener?.close();
        this.qrSessions.delete(key);
      }
    }
    for (const [token, auth] of this.authSessions) {
      if (auth.expiresAt <= current) this.authSessions.delete(token);
    }
  }

  private backoff(): number {
    this.failureCount += 1;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.failureCount - 1), BACKOFF_MAX_MS);
    this.nextQrAllowedAt = this.now() + delay;
    return delay;
  }

  private activeQrExists(): boolean {
    return Array.from(this.qrSessions.values()).some((session) => !terminalState(session.state));
  }

  private sessionFor(key: string): QrSession {
    this.cleanup();
    const session = this.qrSessions.get(key);
    if (!session) throw new QrLoginServiceError('QR session not found or expired', 404);
    return session;
  }

  private authFor(token?: string): AuthSession | null {
    this.cleanup();
    return token ? (this.authSessions.get(token) ?? null) : null;
  }

  /**
   * Turns a pre-session bootstrap failure into a backed-off client error, so repeated clicks
   * get one 502 with Retry-After and then 429s instead of a stream of upstream calls.
   */
  private failBootstrap(error: unknown): QrLoginServiceError {
    if (error instanceof QrLoginServiceError) return error;
    const bootstrap = error instanceof QqDeviceBootstrapError ? error : null;
    const protocol = error instanceof QqProtocolError ? error : null;
    const retryAfterMs = this.backoff();
    const upstreamCode = bootstrap?.outerCode ?? protocol?.upstreamCode;
    logger.warn('qq-auth.bootstrap-failed', {
      phase: bootstrap ? 'qimei' : (protocol?.phase ?? 'unknown'),
      outerCode: bootstrap?.outerCode,
      innerCode: bootstrap?.innerCode,
      upstreamCode: protocol?.upstreamCode,
      retryAfterMs,
      name: error instanceof Error ? error.name : 'Error',
    });
    return new QrLoginServiceError('Unable to start QR login', 502, retryAfterMs, upstreamCode);
  }

  private failSession(session: QrSession, error: unknown): void {
    if (terminalState(session.state)) return;
    session.state = 'failed';
    session.upstreamCode = upstreamCodeOf(error);
    session.retryAfterMs = this.backoff();
    logger.warn('qq-auth.session-failed', {
      loginChannel: session.channel,
      upstreamCode: session.upstreamCode,
      retryAfterMs: session.retryAfterMs,
      name: error instanceof Error ? error.name : 'Error',
    });
  }

  /** App channel: the MQTT payload carries an exchange token, never the final credential. */
  private async exchangeMobileLogin(session: QrSession, payload: unknown): Promise<QqCredential> {
    const cookies = dictionaryOf(dictionaryOf(payload).cookies);
    const musicid = stringOf(dictionaryOf(cookies.qqmusic_uin).value);
    const mqttToken = stringOf(dictionaryOf(cookies.qqmusic_key).value);
    if (!musicid || !mqttToken || !session.qrcodeId)
      throw new Error('MQTT cookies missing login credential');
    session.state = 'exchanging';
    const device = this.deviceStore.get();
    try {
      return await exchangeCredential(this.http, device, session.qrcodeId, musicid, mqttToken);
    } catch (error) {
      const direct = {
        musicid,
        str_musicid: musicid,
        musickey: mqttToken,
        loginType: MOBILE_LOGIN_TYPE,
      };
      await getLoginUser(this.http, {
        token: '',
        credential: direct,
        device,
        expiresAt: 0,
      });
      logger.warn('qq-auth.exchange-fallback', {
        upstreamCode: error instanceof QqProtocolError ? error.upstreamCode : undefined,
      });
      return direct;
    }
  }

  /** WeChat channel: the web flow yields an OAuth code, and there is no MQTT fallback. */
  private async exchangeWechatLogin(session: QrSession, payload: unknown): Promise<QqCredential> {
    const code = stringOf(dictionaryOf(payload).code);
    if (!code) throw new WechatQrError('WeChat authorization missing code');
    session.state = 'exchanging';
    return exchangeWechatCredential(this.http, this.deviceStore.get(), code);
  }

  private async finalizeLogin(session: QrSession, payload: unknown): Promise<void> {
    let credential =
      session.channel === 'wechat'
        ? await this.exchangeWechatLogin(session, payload)
        : await this.exchangeMobileLogin(session, payload);
    if (session.channel === 'wechat')
      credential = await validateWechatCredential(this.http, this.deviceStore.get(), credential);
    const token = this.random(32).toString('hex');
    this.authSessions.set(token, {
      token,
      credential,
      device: this.deviceStore.get(),
      expiresAt: this.now() + AUTH_TTL_MS,
    });
    session.authToken = token;
    session.state = 'confirmed';
    this.failureCount = 0;
    this.nextQrAllowedAt = 0;
    logger.info('qq-auth.login-confirmed', {
      loginChannel: session.channel,
      hasCredential: true,
      credentialLoginType: credential.loginType,
      credentialKeys: Object.keys(credential).sort(),
      credentialKeyLength: credential.musickey.length,
    });
  }

  private onQrEvent(session: QrSession, event: QrEvent): void {
    if (terminalState(session.state)) return;
    if (event.type === 'waiting') session.state = 'waiting';
    else if (event.type === 'scanned') session.state = 'scanned';
    else if (event.type === 'cookies' || event.type === 'authorized') {
      void this.finalizeLogin(session, event.payload).catch((error) =>
        this.failSession(session, error),
      );
    } else if (['canceled', 'timeout', 'loginFailed'].includes(event.type ?? '')) {
      session.state = 'expired';
      session.retryAfterMs = this.backoff();
    }
  }

  public async createSession(channel: QrLoginChannel = DEFAULT_LOGIN_CHANNEL): Promise<string> {
    if (!isSupportedLoginChannel(channel))
      throw new QrLoginServiceError(`Unsupported QR login channel: ${channel}`, 400);
    this.cleanup();
    const retryAfterMs = Math.max(0, this.nextQrAllowedAt - this.now());
    if (retryAfterMs > 0)
      throw new QrLoginServiceError('QR login is temporarily backed off', 429, retryAfterMs);
    if (this.creatingSession || this.activeQrExists())
      throw new QrLoginServiceError('Another QR login is already active', 409);
    this.creatingSession = true;
    try {
      const device = this.deviceStore.get();
      if (await ensureQimei(this.http, device, this.now())) this.deviceStore.persist();
      await refreshAndroidSession(this.http, device);
      this.deviceStore.persist();
      const key = this.random(24).toString('hex');
      this.qrSessions.set(key, {
        key,
        channel,
        state: 'created',
        createdAt: this.now(),
        expiresAt: this.now() + QR_TTL_MS,
      });
      logger.info('qq-auth.qr-session-created', { loginChannel: channel });
      return key;
    } catch (error) {
      throw this.failBootstrap(error);
    } finally {
      this.creatingSession = false;
    }
  }

  private sessionHttp(session: QrSession): AuthHttpClient {
    if (!session.http) session.http = this.createSessionHttp();
    return session.http;
  }

  private async createChannelQr(
    session: QrSession,
  ): Promise<{ identifier: string; imageUrl: string; expiresIn?: number }> {
    if (session.channel === 'wechat') return createWechatQr(this.sessionHttp(session));
    const qr = await createNativeQr(this.http, this.deviceStore.get());
    return { identifier: qr.qrcodeId, imageUrl: qr.imageUrl, expiresIn: qr.expiresIn };
  }

  private listenForChannel(session: QrSession, identifier: string): QrEventListener {
    const onEvent = (event: QrEvent): void => this.onQrEvent(session, event);
    const timeoutMs = session.expiresAt - this.now();
    if (session.channel === 'wechat') {
      return createWechatQrListener(
        { http: this.sessionHttp(session), sleep: this.sleep, now: this.now },
        identifier,
        onEvent,
        timeoutMs,
      );
    }
    return this.listen(identifier, onEvent, timeoutMs);
  }

  public async createQr(key: string): Promise<string> {
    const session = this.sessionFor(key);
    if (session.imageUrl) return session.imageUrl;
    if (session.state !== 'created')
      throw new QrLoginServiceError('QR session cannot create another code', 409);
    session.state = 'creating';
    try {
      const qr = await this.createChannelQr(session);
      session.identifier = qr.identifier;
      if (session.channel === 'mobile') session.qrcodeId = qr.identifier;
      session.imageUrl = qr.imageUrl;
      if (qr.expiresIn && qr.expiresIn > 0) {
        session.expiresAt = Math.min(session.expiresAt, this.now() + qr.expiresIn * 1000);
      }
      logger.info('qq-auth.qr-created', {
        loginChannel: session.channel,
        qrIdentifierLength: qr.identifier.length,
      });
      session.listener = this.listenForChannel(session, qr.identifier);
      void session.listener.done.catch((error) => this.failSession(session, error));
      await session.listener.ready;
      return qr.imageUrl;
    } catch (error) {
      this.failSession(session, error);
      throw new QrLoginServiceError('Unable to create QR login', 502, session.retryAfterMs);
    }
  }

  public checkQr(key: string): QrCheckResult {
    try {
      const session = this.sessionFor(key);
      if (session.state === 'confirmed' && session.authToken) {
        return {
          code: 803,
          message: 'Authorization login successful',
          cookie: `qqmusic_session=${session.authToken}`,
        };
      }
      if (session.state === 'scanned' || session.state === 'exchanging')
        return { code: 802, message: 'QR code scanned' };
      if (session.state === 'expired' || session.state === 'failed')
        return this.failedCheckResult(session);
      return { code: 801, message: 'Waiting for QR scan' };
    } catch {
      return { code: 800, message: 'QR code expired' };
    }
  }

  private failedCheckResult(session: QrSession): QrCheckResult {
    return {
      code: 800,
      message: session.state === 'expired' ? 'QR code expired' : 'QR login failed',
      ...(session.upstreamCode === undefined ? {} : { upstreamCode: session.upstreamCode }),
      ...(session.retryAfterMs === undefined ? {} : { retryAfterMs: session.retryAfterMs }),
    };
  }

  public async getLoginStatus(token?: string): Promise<Dictionary | null> {
    const auth = this.authFor(token);
    return auth ? getLoginProfile(this.http, auth) : null;
  }

  public async getUserDetail(token?: string): Promise<Dictionary | null> {
    const auth = this.authFor(token);
    return auth ? getLoginProfile(this.http, auth) : null;
  }

  public async getUserPlaylists(token?: string, uin?: string): Promise<Dictionary | null> {
    const auth = this.authFor(token);
    return auth ? getPlaylists(this.http, auth, uin) : null;
  }

  public async getUserLikedSongs(
    token?: string,
    offset?: number,
    limit?: number,
  ): Promise<Dictionary | null> {
    const auth = this.authFor(token);
    return auth ? getLikedSongs(this.http, auth, offset, limit) : null;
  }

  public async getMusicPlay(
    token: string | undefined,
    songmid: string,
    quality?: string | number,
    mediaId?: string,
  ): Promise<Dictionary | null> {
    const auth = this.authFor(token);
    return auth ? getAuthenticatedPlayUrls(this.http, auth, songmid, quality, mediaId) : null;
  }

  public logout(token?: string): void {
    if (token) this.authSessions.delete(token);
    for (const session of this.qrSessions.values()) session.listener?.close();
    this.qrSessions.clear();
  }
}

export const createQrLoginService = (dependencies: QrLoginDependencies = {}): QrLoginService =>
  new QrLoginServiceImpl(dependencies);

export const qrLoginService = createQrLoginService();

export default qrLoginService;
