// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeLocalCoverRuntime } from '../../../src/services/localCoverRuntime';
import { isLocalCoverWebRuntimeSupported } from '../../../src/services/localCoverBinaryStore';
import { migrateLegacyLocalCoverAssetsInBackground } from '../../../src/services/localCoverAssetService';

// test/unit/services/localCoverRuntime.test.ts
// Verifies local-cover startup never waits on a service worker and re-requests covers once one takes control.

vi.mock('../../../src/services/localCoverBinaryStore', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/services/localCoverBinaryStore')>(),
  isLocalCoverWebRuntimeSupported: vi.fn(() => true),
}));

vi.mock('../../../src/services/localCoverAssetService', () => ({
  migrateLegacyLocalCoverAssetsInBackground: vi.fn(() => new Promise<void>(() => undefined)),
}));

const COVER_URL = `/__folia_cover/sha256%3A${'a'.repeat(64)}?size=512`;

const addImage = (src: string, naturalWidth = 0): HTMLImageElement => {
  const image = document.createElement('img');
  image.setAttribute('src', src);
  // jsdom never decodes images; a positive width stands in for a cover that loaded.
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: naturalWidth });
  document.body.appendChild(image);
  return image;
};

const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('local cover runtime', () => {
  let serviceWorker: EventTarget & { register: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    serviceWorker = Object.assign(new EventTarget(), { register: vi.fn() });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    vi.mocked(isLocalCoverWebRuntimeSupported).mockReturnValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('registers no worker of its own and returns without waiting for one', () => {
    expect(initializeLocalCoverRuntime()).toBeUndefined();
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  it('re-requests covers that failed once a worker takes control of the page', async () => {
    const broken = addImage(COVER_URL);
    const loaded = addImage(COVER_URL, 512);
    const remote = addImage('https://example.com/cover.jpg');
    initializeLocalCoverRuntime();

    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(broken.hasAttribute('src')).toBe(false);
    await flushMicrotasks();

    expect(broken.getAttribute('src')).toBe(COVER_URL);
    expect(loaded.getAttribute('src')).toBe(COVER_URL);
    expect(remote.getAttribute('src')).toBe('https://example.com/cover.jpg');
  });

  it('does not watch the worker where covers use the Electron protocol', () => {
    vi.mocked(isLocalCoverWebRuntimeSupported).mockReturnValue(false);
    const broken = addImage(COVER_URL);
    initializeLocalCoverRuntime();

    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(broken.getAttribute('src')).toBe(COVER_URL);
  });

  it('re-requests covers that failed before the legacy migration finished', async () => {
    vi.mocked(migrateLegacyLocalCoverAssetsInBackground).mockResolvedValueOnce(undefined);
    const broken = addImage(COVER_URL);
    const previousSources: Array<string | null> = [];
    new MutationObserver(records => records.forEach(record => previousSources.push(record.oldValue)))
      .observe(broken, { attributeFilter: ['src'], attributeOldValue: true });

    initializeLocalCoverRuntime();
    await flushMicrotasks();

    // Removed, then set back: the browser only re-requests an image whose src actually changes.
    expect(previousSources).toEqual([COVER_URL, null]);
    expect(broken.getAttribute('src')).toBe(COVER_URL);
  });
});
