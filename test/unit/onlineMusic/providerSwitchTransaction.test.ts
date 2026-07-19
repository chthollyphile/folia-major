import { describe, expect, it, vi } from 'vitest';
import { switchOnlineProviderTransaction } from '@/hooks/useOnlineProviderPlatform';

// test/unit/onlineMusic/providerSwitchTransaction.test.ts

describe('online provider switch transaction', () => {
    it('does not commit or refresh when cleanup confirmation is cancelled', async () => {
        const commit = vi.fn();
        const refresh = vi.fn();
        const prepare = vi.fn().mockResolvedValue(false);
        await expect(switchOnlineProviderTransaction({
            currentProviderId: 'netease', nextProviderId: 'kugou', prepare, commit, refresh,
        })).resolves.toBe(false);
        expect(commit).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('cleans up before committing and refreshes only the new provider', async () => {
        const order: string[] = [];
        const prepare = vi.fn(async () => { order.push('cleanup'); return true; });
        const commit = vi.fn(() => { order.push('commit'); });
        const refresh = vi.fn(async () => { order.push('refresh'); });
        await expect(switchOnlineProviderTransaction({
            currentProviderId: 'netease', nextProviderId: 'kugou', prepare, commit, refresh,
        })).resolves.toBe(true);
        expect(order).toEqual(['cleanup', 'commit', 'refresh']);
        expect(commit).toHaveBeenCalledWith('kugou');
    });
});
