// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLatticeSettingsStore } from '@/stores/useLatticeSettingsStore';
import { BravaisTileBadge } from '@/library/suites/bravais/BravaisTileMarks';
import type { BravaisItem } from '@/library/suites/bravais/bravaisLayer';

// test/unit/library/bravais/bravaisTileBadge.test.ts
// 磁贴左上角的标签（#930「只显示正在播放的序号」）：开关默认关，所有卡片照常画；开着时只有正在播放的歌曲卡片保留序号，
// 其他歌曲卡片的纯数字序号不画，首页 / 探索页带文字的类型标签照旧；换了正在播放的那张，序号跟着换。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const track = (badge: string): BravaisItem => ({ key: `track:${badge}`, kind: 'track', title: 'Song', subtitle: 'Artist', badge });
const playlist: BravaisItem = { key: 'card:p', kind: 'playlist', title: 'Mix', subtitle: '', badge: '歌单 · 12' };
const exploreSong: BravaisItem = { key: 'song:e', kind: 'track', title: 'Song', subtitle: 'Artist', badge: '歌曲' };

const render = (items: readonly { item: BravaisItem; current: boolean }[]) => {
    act(() => root.render(createElement('div', null, items.map(({ item, current }) => createElement(BravaisTileBadge, { key: item.key, item, current })))));
};
const badges = () => Array.from(container.querySelectorAll('.lattice-poster-badge')).map(node => node.textContent);

beforeEach(() => {
    useLatticeSettingsStore.setState({ latticeBadgeCurrentOnly: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('BravaisTileBadge with "number only the playing song"', () => {
    it('is off by default and draws every badge', () => {
        expect(useLatticeSettingsStore.getState().latticeBadgeCurrentOnly).toBe(false);
        render([{ item: track('01'), current: false }, { item: track('02'), current: true }, { item: playlist, current: false }]);
        expect(badges()).toEqual(['01', '02', '歌单 · 12']);
        expect(container.querySelectorAll('.lattice-poster-badge.is-current')).toHaveLength(1);
    });

    it('keeps only the playing track\'s number, and the type labels, when on', () => {
        act(() => useLatticeSettingsStore.setState({ latticeBadgeCurrentOnly: true }));
        render([
            { item: track('01'), current: false },
            { item: track('02'), current: true },
            { item: track('13'), current: false },
            { item: playlist, current: false },
            { item: exploreSong, current: false },
        ]);
        expect(badges()).toEqual(['02', '歌单 · 12', '歌曲']);
        expect(container.querySelector('.lattice-poster-badge.is-current')?.textContent).toBe('02');
    });

    it('moves the number to the new playing track and brings every number back when turned off', () => {
        act(() => useLatticeSettingsStore.setState({ latticeBadgeCurrentOnly: true }));
        render([{ item: track('01'), current: true }, { item: track('02'), current: false }]);
        expect(badges()).toEqual(['01']);

        render([{ item: track('01'), current: false }, { item: track('02'), current: true }]);
        expect(badges()).toEqual(['02']);

        act(() => useLatticeSettingsStore.setState({ latticeBadgeCurrentOnly: false }));
        expect(badges()).toEqual(['01', '02']);
    });
});
