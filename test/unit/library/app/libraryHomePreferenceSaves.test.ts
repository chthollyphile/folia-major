// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLibraryHomeResources } from '@/library/app/useLibraryHomeResources';
import { omni } from '@/services/onlineMusic/omni';
import type { HomeSurfaceProps } from '@/components/app/home/homeSurfaceTypes';
import type { LibraryHomeResources } from '@/library/core/home/homeModel.contract';

// test/unit/library/app/libraryHomePreferenceSaves.test.ts
// 账号上的推荐偏好存过：电台页的卡片读过的就按新偏好重读（每日推荐那张的封面跟着换）；别的平台、还没读过的不动；
// 首页卸载后不再听。

let root: Root | null = null;

const mount = async () => {
    let listener: ((providerId: string) => void) | null = null;
    const stop = vi.fn();
    vi.spyOn(omni, 'subscribeRecommendationPreferenceSaves').mockImplementation(next => {
        listener = next;
        return stop;
    });
    let resources: LibraryHomeResources | null = null;
    const Probe = () => {
        resources = useLibraryHomeResources({} as HomeSurfaceProps);
        return null;
    };
    const host = document.createElement('div');
    await act(async () => {
        root = createRoot(host);
        root.render(React.createElement(Probe));
    });
    const radioFeed = resources!.radioFeed;
    const reload = vi.spyOn(radioFeed, 'reload');
    const shows = (owner: { providerId: string; userId: string } | null, loaded: boolean) => {
        vi.spyOn(radioFeed, 'getSnapshot').mockReturnValue({
            owner,
            loaded,
            status: loaded ? 'ready' : 'idle',
            data: loaded ? { hasPersonalFm: false, dailyCount: 0, dailyCoverUrl: '', supportsDailySongs: true, recommended: [] } : null,
        });
    };
    return { tell: (providerId: string) => listener?.(providerId), reload, radioFeed, shows, stop };
};

const deferHomeFeed = () => {
    type HomeFeed = Awaited<ReturnType<typeof omni.getHomeFeed>>;
    let complete!: (feed: HomeFeed) => void;
    const pending = new Promise<HomeFeed>(resolve => { complete = resolve; });
    const empty: HomeFeed = { personalFm: [], dailySongs: [], recommendedCollections: [] };
    vi.spyOn(omni, 'supportsDailySongs').mockReturnValue(true);
    const read = vi.spyOn(omni, 'getHomeFeed').mockReturnValueOnce(pending).mockResolvedValue(empty);
    return { read, complete: () => complete({ ...empty, partial: true }) };
};

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.restoreAllMocks();
});

describe('the radio cards after the account preferences are saved', () => {
    it('reads the cards again when they were read for that provider', async () => {
        const { tell, reload, shows } = await mount();
        shows({ providerId: 'p', userId: 'u1' }, true);
        tell('p');
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('leaves cards of another provider, and cards not read yet, alone', async () => {
        const { tell, reload, shows } = await mount();
        shows({ providerId: 'other', userId: 'u1' }, true);
        tell('p');
        shows({ providerId: 'p', userId: 'u1' }, false);
        tell('p');
        shows(null, false);
        tell('p');
        expect(reload).not.toHaveBeenCalled();
    });

    it('reads the cards once more after the first load if preferences were saved during it', async () => {
        const { tell, reload, radioFeed } = await mount();
        const { read, complete } = deferHomeFeed();
        radioFeed.setOwner({ providerId: 'p', userId: 'u1' });
        const initial = radioFeed.ensure();
        expect(radioFeed.getSnapshot()).toMatchObject({ status: 'loading', loaded: false });

        tell('p');
        tell('p');
        expect(reload).not.toHaveBeenCalled();

        complete();
        await initial;
        expect(reload).toHaveBeenCalledTimes(1);
        await reload.mock.results[0].value;
        expect(read).toHaveBeenCalledTimes(2);
        expect(radioFeed.getSnapshot()).toMatchObject({ status: 'ready', loaded: true });
    });

    it('refreshes a partial feed that already shows its cards', async () => {
        const { tell, reload, radioFeed } = await mount();
        const { read, complete } = deferHomeFeed();
        radioFeed.setOwner({ providerId: 'p', userId: 'u1' });
        const initial = radioFeed.ensure();
        complete();
        await initial;
        expect(radioFeed.getSnapshot()).toMatchObject({
            status: 'ready', loaded: false, data: { partial: true, supportsDailySongs: true },
        });

        tell('p');
        expect(reload).toHaveBeenCalledTimes(1);
        await reload.mock.results[0].value;
        expect(read).toHaveBeenCalledTimes(2);
        expect(radioFeed.getSnapshot()).toMatchObject({ status: 'ready', loaded: true });
    });

    it('drops the queued read when a different account claims the cards', async () => {
        const { tell, reload, radioFeed } = await mount();
        const { complete } = deferHomeFeed();
        radioFeed.setOwner({ providerId: 'p', userId: 'u1' });
        const initial = radioFeed.ensure();

        tell('p');
        radioFeed.setOwner({ providerId: 'p', userId: 'u2' });
        await radioFeed.ensure();
        complete();
        await initial;

        expect(reload).not.toHaveBeenCalled();
    });

    it('stops listening when the home goes away', async () => {
        const { stop } = await mount();
        act(() => root?.unmount());
        root = null;
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
