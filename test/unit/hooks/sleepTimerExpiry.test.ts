import { describe, expect, it, vi } from 'vitest';
import { runSleepTimerExpiryAction } from '../../../src/hooks/sleepTimerExpiry';

// test/unit/hooks/sleepTimerExpiry.test.ts

describe('sleep timer expiry action', () => {
    it('pauses through the fallback when no desktop quit bridge exists', async () => {
        const onFallback = vi.fn();

        await runSleepTimerExpiryAction({ onFallback });

        expect(onFallback).toHaveBeenCalledOnce();
    });

    it('does not pause when the desktop app accepts the quit request', async () => {
        const onFallback = vi.fn();

        await runSleepTimerExpiryAction({
            quitApp: vi.fn(async () => true),
            onFallback,
        });

        expect(onFallback).not.toHaveBeenCalled();
    });

    it('falls back to pausing when quitting is rejected or fails', async () => {
        const rejectedFallback = vi.fn();
        const failedFallback = vi.fn();

        await runSleepTimerExpiryAction({
            quitApp: vi.fn(async () => false),
            onFallback: rejectedFallback,
        });
        await runSleepTimerExpiryAction({
            quitApp: vi.fn(async () => { throw new Error('ipc unavailable'); }),
            onFallback: failedFallback,
        });

        expect(rejectedFallback).toHaveBeenCalledOnce();
        expect(failedFallback).toHaveBeenCalledOnce();
    });
});
