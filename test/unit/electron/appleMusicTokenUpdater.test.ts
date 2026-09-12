import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/appleMusicTokenUpdater.test.ts

const require = createRequire(import.meta.url);
const { createTokenUpdater } = require('../../../electron/appleMusic/tokenUpdater.cjs');

describe('live MusicKit token rotation', () => {
    it('rechecks the source and configures only changed tokens across concurrent requests', async () => {
        let token = 'first';
        const resolveToken = vi.fn(async () => token);
        const configure = vi.fn(async () => {});
        const updater = createTokenUpdater({ resolveToken, configure });
        await Promise.all([updater.update(), updater.update()]);
        expect(configure).toHaveBeenCalledTimes(1);
        await updater.update();
        expect(resolveToken).toHaveBeenCalledTimes(2);
        expect(configure).toHaveBeenCalledTimes(1);
        token = 'renewed';
        await updater.update();
        expect(configure).toHaveBeenLastCalledWith('renewed');
        expect(configure).toHaveBeenCalledTimes(2);
    });
    it('retries failed configuration and reapplies the token when the player is recreated', async () => {
        const configure = vi.fn().mockRejectedValueOnce(new Error('configure failed')).mockResolvedValue(undefined);
        const updater = createTokenUpdater({ resolveToken: async () => 'token', configure });
        await expect(updater.update()).rejects.toThrow('configure failed');
        await updater.update();
        updater.reset();
        await updater.update();
        expect(configure).toHaveBeenCalledTimes(3);
    });
});
