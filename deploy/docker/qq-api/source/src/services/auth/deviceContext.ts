import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../util/logger';

// Android device context for the native QR login protocol.
// The QIMEI bootstrap and every musicu.fcg call must run on ONE stable identity, so the
// context has to survive a process restart instead of being regenerated on every boot.
// Values here identify a synthetic device, never a user: no musickey, MQTT token or QR key
// is ever stored, logged or returned.

export const DEVICE_STATE_ENV = 'QQ_AUTH_STATE_PATH';
export const MEMORY_STATE_PATH = 'memory';
const DEFAULT_STATE_PATH = path.join('.auth-state', 'qq-device.json');
const STATE_FILE_MODE = 0o600;
const STATE_VERSION = 1;

export interface AndroidDevice {
  display: string;
  product: string;
  device: string;
  board: string;
  model: string;
  fingerprint: string;
  procVersion: string;
  imei: string;
  brand: string;
  androidId: string;
  openUdid: string;
  osRelease: string;
  sdk: number;
  qimei?: string;
  qimei36?: string;
  qimeiSavedAt?: number;
  sessionUid?: string;
  sessionSid?: string;
  sessionVkey?: unknown;
  [key: string]: unknown;
}

export interface DeviceContextRepository {
  readonly kind: 'file' | 'memory';
  load(): AndroidDevice | null;
  save(device: AndroidDevice): void;
  clear(): void;
}

export interface DeviceContextStore {
  get(): AndroidDevice;
  persist(): void;
  reset(): AndroidDevice;
}

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

const randomImei = (): string => {
  const digits = randomDigits(14).split('').map(Number);
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = digits[index];
    if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  digits.push((10 - (sum % 10)) % 10);
  return digits.join('');
};

export const createAndroidDevice = (): AndroidDevice => ({
  display: `QMAPI.${randomDigits(6)}.001`,
  product: 'iarim',
  device: 'sagit',
  board: 'eomam',
  model: 'MI 6',
  fingerprint: `xiaomi/iarim/sagit:10/eomam.200122.001/${randomDigits(7)}:user/release-keys`,
  procVersion: `Linux 5.4.0-54-generic-${randomHex(8)} (android-build@google.com)`,
  imei: randomImei(),
  brand: 'Xiaomi',
  androidId: randomHex(16),
  openUdid: randomHex(32),
  osRelease: '10',
  sdk: 29,
});

const REQUIRED_TEXT_FIELDS = [
  'display',
  'product',
  'device',
  'board',
  'model',
  'fingerprint',
  'procVersion',
  'imei',
  'brand',
  'androidId',
  'openUdid',
  'osRelease',
] as const;

const OPTIONAL_TEXT_FIELDS = ['qimei', 'qimei36', 'sessionUid', 'sessionSid'] as const;

/** Rejects a truncated or hand-edited state file so a bad shape never reaches the protocol. */
export const isAndroidDevice = (value: unknown): value is AndroidDevice => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!Number.isFinite(candidate.sdk)) return false;
  if (candidate.qimeiSavedAt !== undefined && !Number.isFinite(candidate.qimeiSavedAt))
    return false;
  const hasText = (key: string): boolean =>
    typeof candidate[key] === 'string' && (candidate[key] as string).length > 0;
  if (!REQUIRED_TEXT_FIELDS.every(hasText)) return false;
  return OPTIONAL_TEXT_FIELDS.every((key) => candidate[key] === undefined || hasText(key));
};

/**
 * Safe log/diagnostic shape: presence and shape only, never an identifier value.
 */
export const describeDeviceContext = (device: AndroidDevice | null): Record<string, unknown> => ({
  hasDevice: Boolean(device),
  hasQimei: Boolean(device?.qimei && device?.qimei36),
  qimeiAgeMs:
    device?.qimeiSavedAt === undefined ? undefined : Math.max(0, Date.now() - device.qimeiSavedAt),
  hasSession: Boolean(device?.sessionUid && device?.sessionSid),
});

export const createMemoryDeviceContextRepository = (
  seed: AndroidDevice | null = null,
): DeviceContextRepository => {
  let stored = seed ? ({ ...seed } as AndroidDevice) : null;
  return {
    kind: 'memory',
    load: () => (stored ? ({ ...stored } as AndroidDevice) : null),
    save: (device) => {
      stored = { ...device };
    },
    clear: () => {
      stored = null;
    },
  };
};

/**
 * Persists the device context as owner-only JSON. Every filesystem failure degrades to an
 * in-process context instead of blocking login: a read-only container still works, it just
 * re-registers a device on the next restart.
 */
export const createFileDeviceContextRepository = (filePath: string): DeviceContextRepository => ({
  kind: 'file',
  load: () => {
    try {
      if (!fs.existsSync(filePath)) return null;
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const record = typeof parsed === 'object' && parsed !== null ? parsed : {};
      const device = (record as Record<string, unknown>).device;
      if (!isAndroidDevice(device)) {
        logger.warn('qq-auth.device-context.invalid-state', { kind: 'file' });
        return null;
      }
      return device;
    } catch (error) {
      logger.warn('qq-auth.device-context.load-failed', {
        name: error instanceof Error ? error.name : 'Error',
      });
      return null;
    }
  },
  save: (device) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        `${JSON.stringify({ version: STATE_VERSION, device }, null, 2)}\n`,
        {
          encoding: 'utf8',
          mode: STATE_FILE_MODE,
        },
      );
    } catch (error) {
      logger.warn('qq-auth.device-context.save-failed', {
        name: error instanceof Error ? error.name : 'Error',
      });
    }
  },
  clear: () => {
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      logger.warn('qq-auth.device-context.clear-failed', {
        name: error instanceof Error ? error.name : 'Error',
      });
    }
  },
});

export const resolveDeviceStatePath = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const configured = env[DEVICE_STATE_ENV]?.trim();
  if (configured === MEMORY_STATE_PATH) return null;
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), DEFAULT_STATE_PATH);
};

export const createDefaultDeviceContextRepository = (
  env: NodeJS.ProcessEnv = process.env,
): DeviceContextRepository => {
  const statePath = resolveDeviceStatePath(env);
  return statePath
    ? createFileDeviceContextRepository(statePath)
    : createMemoryDeviceContextRepository();
};

/**
 * Loads the persisted context lazily on first use, so importing the auth service never
 * touches the filesystem, and writes back after each protocol step that mutates it.
 */
export const createDeviceContextStore = (
  repository: DeviceContextRepository,
): DeviceContextStore => {
  let device: AndroidDevice | null = null;

  const load = (): AndroidDevice => {
    if (device) return device;
    const restored = repository.load();
    device = restored ?? createAndroidDevice();
    logger.info('qq-auth.device-context.ready', {
      kind: repository.kind,
      source: restored ? 'restored' : 'created',
      ...describeDeviceContext(device),
    });
    if (!restored) repository.save(device);
    return device;
  };

  return {
    get: load,
    persist: () => {
      if (device) repository.save(device);
    },
    reset: () => {
      device = createAndroidDevice();
      repository.save(device);
      logger.info('qq-auth.device-context.ready', {
        kind: repository.kind,
        source: 'reset',
        ...describeDeviceContext(device),
      });
      return device;
    },
  };
};

export default createDeviceContextStore;
