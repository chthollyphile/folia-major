// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLatticeSettingsStore } from '@/stores/useLatticeSettingsStore';
import { BravaisTileBadge } from '@/library/suites/bravais/BravaisTileMarks';
import type { BravaisItem } from '@/library/suites/bravais/bravaisLayer';

// test/unit/library/bravais/bravaisTileBadge.test.ts
// 磁贴左上角的标签（#930「只显示正在播放的序号」）：歌曲序号（item.badgeIsIndex）挂 is-index、正在播放的挂 is-current，
// 开关开着时由墙面根上的 has-badge-current-only 按这两个 class 藏（wall.css）；首页 / 探索页带文字的类型标签不挂 is-index。
// 开关默认关。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const track = (badge: string): BravaisItem => ({ key: `track:${badge}`, kind: 'track', title: 'Song', subtitle: 'Artist', badge, badgeIsIndex: true });
const playlist: BravaisItem = { key: 'card:p', kind: 'playlist', title: 'Mix', subtitle: '', badge: '歌单 · 12' };
const exploreSong: BravaisItem = { key: 'song:e', kind: 'track', title: 'Song', subtitle: 'Artist', badge: '歌曲' };

const render = (items: readonly { item: BravaisItem; current: boolean }[]) => {
    act(() => root.render(createElement('div', null, items.map(({ item, current }) => createElement(BravaisTileBadge, { key: item.key, item, current })))));
};
const textsOf = (selector: string) => Array.from(container.querySelectorAll(selector)).map(node => node.textContent);

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('BravaisTileBadge and "number only the playing song"', () => {
    it('is off by default', () => {
        expect(useLatticeSettingsStore.getState().latticeBadgeCurrentOnly).toBe(false);
    });

    it('marks the song numbers as index badges, and only them', () => {
        render([
            { item: track('01'), current: false },
            { item: track('02'), current: true },
            { item: playlist, current: false },
            { item: exploreSong, current: false },
        ]);
        expect(textsOf('.lattice-poster-badge')).toEqual(['01', '02', '歌单 · 12', '歌曲']);
        expect(textsOf('.lattice-poster-badge.is-index')).toEqual(['01', '02']);
        // What the wall hides with the switch on: index badges that are not the playing one.
        expect(textsOf('.lattice-poster-badge.is-index:not(.is-current)')).toEqual(['01']);
    });

    it('moves is-current to the new playing song', () => {
        render([{ item: track('01'), current: true }, { item: track('02'), current: false }]);
        expect(textsOf('.lattice-poster-badge.is-current')).toEqual(['01']);

        render([{ item: track('01'), current: false }, { item: track('02'), current: true }]);
        expect(textsOf('.lattice-poster-badge.is-current')).toEqual(['02']);
    });
});
