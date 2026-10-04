import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/spoutOutput.test.ts
// Locks down the pure half of the Spout output module: the helper JSONL line parser, the config
// patch validation/clamping, and the frame queue's backpressure + release bookkeeping. All of it
// is Electron-free by design (see electron/spoutOutput.cjs), so nothing here needs a Windows host,
// a GPU, or the helper binary. The controller factory's side-effectful parts are covered by
// injection and smoke-tested at the bottom.

const require = createRequire(import.meta.url);
const {
  parseSpoutHelperLine,
  validateSpoutConfigPatch,
  normalizeSpoutSenderName,
  clampSpoutResolution,
  clampSpoutFps,
  createSpoutFrameQueue,
  SPOUT_MAX_FRAMES_IN_FLIGHT,
} = require('../../../electron/spoutOutputProtocol.cjs');

interface SpoutFrame {
  handleString: string;
  textureInfo: {
    codedSize: { width: number; height: number };
    visibleRect: { x: number; y: number; width: number; height: number };
  };
  format: 'bgra' | 'rgba';
}

const makeFrame = (overrides: Partial<SpoutFrame> = {}): SpoutFrame => ({
  handleString: '12345678901234567',
  textureInfo: {
    codedSize: { width: 1920, height: 1080 },
    visibleRect: { x: 0, y: 0, width: 1920, height: 1080 },
  },
  format: 'bgra',
  ...overrides,
});

describe('parseSpoutHelperLine', () => {
  it('parses each well-formed helper event type', () => {
    expect(parseSpoutHelperLine('{"type":"ready","senderName":"Folia"}')).toEqual({
      type: 'ready',
      senderName: 'Folia',
    });
    expect(parseSpoutHelperLine('{"type":"done","id":7}')).toEqual({ type: 'done', id: 7 });
    expect(parseSpoutHelperLine('{"type":"frameError","id":9,"message":"boom"}')).toEqual({
      type: 'frameError',
      id: 9,
      message: 'boom',
    });
    expect(parseSpoutHelperLine('{"type":"fatal","code":"name-in-use","message":"taken"}')).toEqual({
      type: 'fatal',
      code: 'name-in-use',
      message: 'taken',
    });
  });

  it('rejects malformed lines without throwing', () => {
    expect(parseSpoutHelperLine('not json')).toBeNull();
    expect(parseSpoutHelperLine('')).toBeNull();
    expect(parseSpoutHelperLine('   ')).toBeNull();
    expect(parseSpoutHelperLine('{"type":"ready"}')).toBeNull(); // missing senderName
    expect(parseSpoutHelperLine('{"type":"done","id":"7"}')).toBeNull(); // id not a number
    expect(parseSpoutHelperLine('{"type":"done","id":-1}')).toBeNull(); // negative id
    expect(parseSpoutHelperLine('{"type":"fatal","code":"not-a-code","message":"x"}')).toBeNull(); // unknown code
    expect(parseSpoutHelperLine('{"type":"mystery"}')).toBeNull();
    expect(parseSpoutHelperLine(null)).toBeNull();
  });

  it('defaults a missing frameError message to an empty string', () => {
    expect(parseSpoutHelperLine('{"type":"frameError","id":2}')).toEqual({
      type: 'frameError',
      id: 2,
      message: '',
    });
  });
});

describe('validateSpoutConfigPatch', () => {
  it('accepts each recognized key and drops nothing', () => {
    expect(validateSpoutConfigPatch({
      enabled: true,
      senderName: '  Folia  ',
      width: 2560,
      height: 1440,
      fps: 30,
    })).toEqual({
      patch: { enabled: true, senderName: 'Folia', width: 2560, height: 1440, fps: 30 },
    });
  });

  it('rejects invalid values with bad-args', () => {
    expect(validateSpoutConfigPatch(null)).toEqual({ error: 'bad-args' });
    expect(validateSpoutConfigPatch('x')).toEqual({ error: 'bad-args' });
    expect(validateSpoutConfigPatch({ enabled: 'yes' })).toEqual({ error: 'bad-args' });
    expect(validateSpoutConfigPatch({ senderName: '   ' })).toEqual({ error: 'bad-args' });
    expect(validateSpoutConfigPatch({ senderName: 'x'.repeat(256) })).toEqual({ error: 'bad-args' });
    // Resolution must be an exact preset pair.
    expect(validateSpoutConfigPatch({ width: 1234, height: 567 })).toEqual({ error: 'bad-args' });
    expect(validateSpoutConfigPatch({ width: 1920 })).toEqual({ error: 'bad-args' });
    expect(validateSpoutConfigPatch({ fps: 45 })).toEqual({ error: 'bad-args' });
  });

  it('trims but keeps valid sender names up to 255 bytes', () => {
    expect(validateSpoutConfigPatch({ senderName: 'x'.repeat(255) }).patch.senderName).toHaveLength(255);
    // 256 ASCII bytes is over limit; a 100-CJK-char name (300 bytes) is too even though it is
    // only 100 characters.
    expect(validateSpoutConfigPatch({ senderName: 'A' + '好'.repeat(100) }).error).toBe('bad-args');
    expect(validateSpoutConfigPatch({ senderName: 'A' + '好'.repeat(84) }).patch.senderName).toHaveLength(85);
  });

  it('rejects names Spout receivers cannot list (non-ASCII first byte, NUL)', () => {
    // Mirrors validate_sender_name in packaging/windows/spout-sender/src/sender_names.rs.
    expect(validateSpoutConfigPatch({ senderName: '歌词' }).error).toBe('bad-args');
    expect(validateSpoutConfigPatch({ senderName: 'Folia\u0000x' }).error).toBe('bad-args');
    expect(validateSpoutConfigPatch({ senderName: 'Folia 歌词' }).patch.senderName).toBe('Folia 歌词');
    expect(normalizeSpoutSenderName('歌词')).toBe('Folia');
  });
});

describe('config normalization', () => {
  it('falls back to defaults for unusable stored values', () => {
    expect(normalizeSpoutSenderName(undefined)).toBe('Folia');
    expect(normalizeSpoutSenderName('  ')).toBe('Folia');
    expect(normalizeSpoutSenderName(' Folia ')).toBe('Folia');
    expect(clampSpoutResolution('junk', 0)).toEqual({ width: 1920, height: 1080 });
    expect(clampSpoutFps(45)).toBe(60);
    expect(clampSpoutFps(30)).toBe(30);
  });

  it('snaps a non-preset resolution to the nearest preset', () => {
    expect(clampSpoutResolution(1300, 700)).toEqual({ width: 1280, height: 720 });
    expect(clampSpoutResolution(2200, 1300)).toEqual({ width: 1920, height: 1080 });
    expect(clampSpoutResolution(3840, 2160)).toEqual({ width: 3840, height: 2160 });
  });
});

describe('createSpoutFrameQueue', () => {
  it('offers frames until the in-flight budget, then drops (releasing immediately)', () => {
    const released: SpoutFrame[] = [];
    const queue = createSpoutFrameQueue({ releaseFrame: (frame: SpoutFrame) => released.push(frame) });

    const first = queue.offer(makeFrame());
    const second = queue.offer(makeFrame());
    expect(first.verdict).toBe('sent');
    expect(second.verdict).toBe('sent');
    expect(queue.inFlightCount).toBe(2);
    expect(released).toHaveLength(0);

    const third = queue.offer(makeFrame());
    expect(third.verdict).toBe('dropped');
    expect(queue.inFlightCount).toBe(2);
    expect(released).toHaveLength(1); // the dropped frame was released, not queued
  });

  it('builds the contract-shaped frame command with a decimal string handle', () => {
    const queue = createSpoutFrameQueue({ releaseFrame: () => {} });
    const { command } = queue.offer(makeFrame({
      handleString: '18446744073709551615',
      textureInfo: {
        codedSize: { width: 3840, height: 2160 },
        visibleRect: { x: 4, y: 8, width: 1920, height: 1080 },
      },
      format: 'bgra',
    }));
    const parsed = JSON.parse(command as string);
    expect(parsed).toMatchObject({
      type: 'frame',
      handle: '18446744073709551615',
      codedWidth: 3840,
      codedHeight: 2160,
      x: 4,
      y: 8,
      width: 1920,
      height: 1080,
      format: 'bgra',
    });
    expect(typeof parsed.id).toBe('number');
  });

  it('releases the texture on done and on frameError acks', () => {
    const released: number[] = [];
    const queue = createSpoutFrameQueue({
      releaseFrame: (frame: SpoutFrame) => released.push(Number(frame.handleString)),
    });
    const { command: commandA } = queue.offer(makeFrame({ handleString: '11' }));
    const { command: commandB } = queue.offer(makeFrame({ handleString: '22' }));
    const idA = JSON.parse(commandA as string).id;
    const idB = JSON.parse(commandB as string).id;

    expect(queue.ack(idA)).toBe(idA);
    expect(queue.ack(idB)).toBe(idB);
    expect(released).toEqual([11, 22]);
    expect(queue.inFlightCount).toBe(0);

    // A repeated ack for an already-released id is a no-op, never a double release.
    expect(queue.ack(idA)).toBeNull();
    expect(released).toEqual([11, 22]);
  });

  it('releaseAll frees every pending texture exactly once (helper exit path)', () => {
    const released: number[] = [];
    const queue = createSpoutFrameQueue({
      releaseFrame: (frame: SpoutFrame) => released.push(Number(frame.handleString)),
    });
    const { command } = queue.offer(makeFrame({ handleString: '1' }));
    queue.offer(makeFrame({ handleString: '2' }));

    expect(queue.releaseAll()).toBe(2);
    expect(queue.inFlightCount).toBe(0);
    expect(released.sort()).toEqual([1, 2]);

    // After releaseAll the ack for an old frame must not release again.
    const id = JSON.parse(command as string).id;
    expect(queue.ack(id)).toBeNull();
    expect(released.sort()).toEqual([1, 2]);

    expect(queue.releaseAll()).toBe(0);
  });

  it('frees a slot after an ack, so the next paint is sent rather than dropped', () => {
    const queue = createSpoutFrameQueue({ releaseFrame: () => {} });
    queue.offer(makeFrame());
    const { command } = queue.offer(makeFrame());
    queue.ack(JSON.parse(command as string).id);

    const afterAck = queue.offer(makeFrame());
    expect(afterAck.verdict).toBe('sent');
    expect(queue.inFlightCount).toBe(2);
  });

  it('defaults to the contract in-flight budget and requires a release callback', () => {
    const queue = createSpoutFrameQueue({ releaseFrame: () => {} });
    let sent = 0;
    while (queue.offer(makeFrame()).verdict === 'sent') {
      sent += 1;
      if (sent > 10) break;
    }
    expect(sent).toBe(SPOUT_MAX_FRAMES_IN_FLIGHT);

    expect(() => createSpoutFrameQueue()).toThrow(/releaseFrame/);
  });
});

describe('createSpoutOutputController (smoke, injected side effects)', () => {
  const {
    createSpoutOutputController,
  } = require('../../../electron/spoutOutput.cjs');

  const makeStore = (initial: Record<string, unknown> = {}) => {
    const data = new Map(Object.entries(initial));
    return {
      get: (key: string) => data.get(key),
      set: (key: string, value: unknown) => void data.set(key, value),
    };
  };

  it('reports helper-missing (not a crash) when the sender binary is absent', () => {
    const onStatusChange = vi.fn();
    const controller = createSpoutOutputController({
      store: makeStore({ SPOUT_OUTPUT_ENABLED: true, SPOUT_OUTPUT_SENDER_NAME: 'Folia' }),
      BrowserWindow: class {},
      getOverlayUrl: () => 'http://127.0.0.1:32108/obs?obs=1&token=x',
      isSupportedPlatform: () => true,
      onStatusChange,
      existsSync: () => false,
      env: {},
      resourcesPath: '/fake/resources',
    });

    const status = controller.applyConfig({});
    expect(status.error).toBe('helper-missing');
    expect(status.enabled).toBe(true);
    expect(status.running).toBe(false);
    expect(onStatusChange).toHaveBeenCalled();
  });

  it('reports unsupported-platform off win32 and refuses to start', () => {
    const controller = createSpoutOutputController({
      store: makeStore({ SPOUT_OUTPUT_ENABLED: true }),
      BrowserWindow: class {},
      getOverlayUrl: () => null,
      isSupportedPlatform: () => false,
      onStatusChange: () => {},
      existsSync: () => true,
      env: {},
      resourcesPath: '/fake/resources',
    });
    const status = controller.applyConfig({});
    expect(status.supported).toBe(false);
    expect(status.error).toBe('unsupported-platform');
  });

  it('persisting a config patch reflects through getStatus', () => {
    const controller = createSpoutOutputController({
      store: makeStore({}),
      BrowserWindow: class {},
      getOverlayUrl: () => null,
      isSupportedPlatform: () => false,
      onStatusChange: () => {},
      existsSync: () => true,
      env: {},
      resourcesPath: '/fake/resources',
    });
    controller.applyConfig({ senderName: 'MySender', width: 3840, height: 2160, fps: 30 });
    expect(controller.getStatus()).toMatchObject({
      senderName: 'MySender',
      width: 3840,
      height: 2160,
      fps: 30,
      enabled: false,
    });
  });
});
