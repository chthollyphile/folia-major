import { describe, expect, it, vi } from 'vitest';
import { heartbeatCommands } from '@/components/command-palette/commands/heartbeatCommands';
import type { CommandPaletteContext } from '@/components/command-palette/types';

// test/unit/command-palette/heartbeatCommands.test.ts
// Commands use the same readiness and session state as the app rather than inferring provider support.

const [start, stop] = heartbeatCommands;
const context = (overrides: Record<string, unknown> = {}) => ({
    playback: {
        canStartHeartbeat: true,
        isHeartbeatMode: false,
        isHeartbeatLoading: false,
        startHeartbeat: vi.fn(async () => true),
        stopHeartbeat: vi.fn(),
        ...overrides,
    },
    shared: { t: (key: string) => key, setStatusMsg: vi.fn() },
} as unknown as CommandPaletteContext);

describe('Heartbeat commands', () => {
    it('only offers start for an eligible idle session', () => {
        expect(start.isAvailable?.(context())).toBe(true);
        expect(start.isAvailable?.(context({ canStartHeartbeat: false }))).toBe(false);
        expect(start.isAvailable?.(context({ isHeartbeatMode: true }))).toBe(false);
        expect(start.isAvailable?.(context({ isHeartbeatLoading: true }))).toBe(false);
    });

    it('lets a pending or active session stop even if the provider becomes unavailable', () => {
        expect(stop.isAvailable?.(context())).toBe(false);
        expect(stop.isAvailable?.(context({ canStartHeartbeat: false, isHeartbeatMode: true }))).toBe(true);
        expect(stop.isAvailable?.(context({ isHeartbeatLoading: true }))).toBe(true);
    });

    it('forwards start and stop to the shared controller', async () => {
        const ctx = context();
        expect(await start.execute('', ctx)).toBe(true);
        expect(ctx.playback.startHeartbeat).toHaveBeenCalledOnce();
        expect(stop.execute('', ctx)).toBe(true);
        expect(ctx.playback.stopHeartbeat).toHaveBeenCalledOnce();
        expect(ctx.shared.setStatusMsg).toHaveBeenCalledWith({ type: 'info', text: 'heartbeat.stopped' });
    });
});
