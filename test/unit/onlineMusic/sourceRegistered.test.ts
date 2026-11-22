import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceRegistered } from '@/services/onlineMusic/sourceReadiness';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { setSourceStates } from '@/services/onlineMusic/sourceStates';
import type { OnlineMusicProvider } from '@/types/onlineMusic';

// test/unit/onlineMusic/sourceRegistered.test.ts
// The wait for one platform in particular (sourceReadiness.sourceRegistered): over once it registers, once it
// is switched off, or once its time runs out; at once when there is nothing to wait for.

const providerId = 'source-registered-test';

const provider = { id: providerId, displayName: providerId, capabilities: {} } as unknown as OnlineMusicProvider;

const state = (promise: Promise<void>) => {
    let done = false;
    void promise.then(() => { done = true; });
    return () => done;
};

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
    setSourceStates({});
    vi.useRealTimers();
});

describe('sourceRegistered', () => {
    it('is over at once for a platform that is registered, or switched off', async () => {
        registerOnlineMusicProvider(provider);
        await expect(sourceRegistered(providerId, 50)).resolves.toBeUndefined();
        unregisterOnlineMusicProvider(providerId);
        setSourceStates({ [providerId]: 'disabled' });
        const done = state(sourceRegistered(providerId, 60_000));
        await Promise.resolve();
        await Promise.resolve();
        expect(done()).toBe(true);
    });

    it('waits for the platform to register', async () => {
        const done = state(sourceRegistered(providerId, 60_000));
        await Promise.resolve();
        expect(done()).toBe(false);
        registerOnlineMusicProvider(provider);
        await Promise.resolve();
        await Promise.resolve();
        expect(done()).toBe(true);
    });

    it('stops waiting when the platform is switched off meanwhile, or the time runs out', async () => {
        const off = state(sourceRegistered(providerId, 60_000));
        setSourceStates({ [providerId]: 'disabled' });
        await Promise.resolve();
        await Promise.resolve();
        expect(off()).toBe(true);
        setSourceStates({});
        vi.useFakeTimers();
        const late = state(sourceRegistered(providerId, 1000));
        await vi.advanceTimersByTimeAsync(999);
        expect(late()).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(late()).toBe(true);
    });
});
