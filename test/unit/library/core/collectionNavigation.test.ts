import { describe, expect, it } from 'vitest';
import type { CollectionNavigationSnapshot, GridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import {
    isSameCollectionPath,
    isSameCollectionVisit,
    projectNavigationTrail,
    resolveCollectionPopTo,
    resolveCollectionPush,
} from '@/library/core/collection/collectionNavigation';

// test/unit/library/core/collectionNavigation.test.ts
// N1 的纯规则：进入集合时只折叠紧邻往返（栈顶相同 → noop，倒数第二层相同 → back，其余 → push，栈里可以有重复）；
// 面包屑跳层（popCollectionTo）的目标栈；以及历史日志比较记录用的两种「同一个位置 / 同一次浏览」。
// B11：导航栈投影成面包屑（按位置、重复的集合各占一项，键与浏览会话一致）。

const online = (type: 'album' | 'artist' | 'playlist', id: string | number, providerId = 'netease') => ({
    source: 'online',
    providerId,
    id,
    name: `${type} ${id}`,
    type,
} as unknown as GridViewCollectionDescriptor);

const playlist = online('playlist', 'root');
const skyline = online('album', 'skyline');
const polaris = online('artist', 'polaris');
const other = online('album', 'other');
const extra = online('artist', 'extra');

const snap = (...stack: GridViewCollectionDescriptor[]): CollectionNavigationSnapshot => ({ origin: 'home', stack });

/** 按决定推进栈：push 压一层，back 弹一层（导航层会走返回），noop 不变。 */
const apply = (current: CollectionNavigationSnapshot, next: GridViewCollectionDescriptor): CollectionNavigationSnapshot => {
    const decision = resolveCollectionPush(current, next);
    if (decision.kind === 'push') return decision.snapshot;
    if (decision.kind === 'back') return decision.to;
    return current;
};

describe('resolveCollectionPush', () => {
    it('does nothing without an open stack', () => {
        expect(resolveCollectionPush(null, skyline)).toEqual({ kind: 'noop' });
        expect(resolveCollectionPush(snap(), skyline)).toEqual({ kind: 'noop' });
    });

    it('pushes a collection that is not in the stack yet', () => {
        const from = snap(playlist, skyline);
        const decision = resolveCollectionPush(from, polaris);
        expect(decision).toEqual({ kind: 'push', snapshot: snap(playlist, skyline, polaris) });
        // 不改输入。
        expect(from.stack).toHaveLength(2);
    });

    it('does nothing for the collection on top', () => {
        expect(resolveCollectionPush(snap(playlist, skyline), skyline)).toEqual({ kind: 'noop' });
        expect(resolveCollectionPush(snap(playlist), playlist)).toEqual({ kind: 'noop' });
        // id 一个是数字一个是字符串也算同一个。
        expect(resolveCollectionPush(snap(online('album', 42)), online('album', '42'))).toEqual({ kind: 'noop' });
    });

    it('treats the layer right below the top as a back (X → Y → X folds back to X)', () => {
        const from = snap(playlist, skyline, polaris);
        expect(resolveCollectionPush(from, skyline)).toEqual({ kind: 'back', to: snap(playlist, skyline) });
        // 根就是倒数第二层时也一样，origin 保留。
        const fromSearch: CollectionNavigationSnapshot = { origin: 'search', stack: [playlist, skyline] };
        expect(resolveCollectionPush(fromSearch, playlist)).toEqual({ kind: 'back', to: { origin: 'search', stack: [playlist] } });
        expect(from.stack).toHaveLength(3);
    });

    it('still pushes a collection that sits deeper than the layer below the top', () => {
        // A B C D E 再点 B：照常压栈，返回路径完整保留（C、D、E 不丢）。
        const from = snap(playlist, skyline, polaris, other, extra);
        expect(resolveCollectionPush(from, skyline)).toEqual({
            kind: 'push',
            snapshot: snap(playlist, skyline, polaris, other, extra, skyline),
        });
        expect(resolveCollectionPush(snap(playlist, skyline, polaris), playlist)).toEqual({
            kind: 'push',
            snapshot: snap(playlist, skyline, polaris, playlist),
        });
    });

    it('compares against the stack positions even when the stack already holds duplicates', () => {
        // A B C B：上一层是 C → 折回；B 在栈顶 → noop；A 更深 → 压栈。
        const from = snap(playlist, skyline, polaris, skyline);
        expect(resolveCollectionPush(from, polaris)).toEqual({ kind: 'back', to: snap(playlist, skyline, polaris) });
        expect(resolveCollectionPush(from, skyline).kind).toBe('noop');
        expect(resolveCollectionPush(from, playlist).kind).toBe('push');
    });

    it('treats another provider or another type with the same id as a different collection', () => {
        expect(resolveCollectionPush(snap(skyline, polaris), online('album', 'skyline', 'kugou')).kind).toBe('push');
        expect(resolveCollectionPush(snap(online('album', 'x'), polaris), online('artist', 'x')).kind).toBe('push');
    });

    it('keeps the depth at 2–3 when bouncing between an artist and an album', () => {
        let current = snap(playlist, skyline);
        for (let round = 0; round < 4; round += 1) {
            current = apply(current, polaris);
            expect(current.stack).toEqual([playlist, skyline, polaris]);
            current = apply(current, skyline);
            expect(current.stack).toEqual([playlist, skyline]);
        }
    });
});

describe('resolveCollectionPopTo', () => {
    const from = snap(playlist, skyline, polaris);

    it('keeps the first depth layers', () => {
        expect(resolveCollectionPopTo(from, 2)).toEqual(snap(playlist, skyline));
        expect(resolveCollectionPopTo(from, 1)).toEqual(snap(playlist));
    });

    it('counts positions, not collections, when the stack holds duplicates', () => {
        const withDuplicate = snap(playlist, skyline, polaris, other, skyline);
        expect(resolveCollectionPopTo(withDuplicate, 2)).toEqual(snap(playlist, skyline));
        expect(resolveCollectionPopTo(withDuplicate, 4)).toEqual(snap(playlist, skyline, polaris, other));
    });

    it('closes everything at depth 0', () => {
        expect(resolveCollectionPopTo(from, 0)).toBeNull();
        expect(resolveCollectionPopTo(snap(playlist), 0)).toBeNull();
    });

    it('ignores a depth that is not shallower than the current one', () => {
        expect(resolveCollectionPopTo(from, 3)).toBeUndefined();
        expect(resolveCollectionPopTo(from, 4)).toBeUndefined();
        expect(resolveCollectionPopTo(from, -1)).toBeUndefined();
        expect(resolveCollectionPopTo(from, 1.5)).toBeUndefined();
        expect(resolveCollectionPopTo(null, 0)).toBeUndefined();
    });
});

describe('collection path comparison', () => {
    it('compares origin, depth and every collectionKey, not the other descriptor fields', () => {
        const renamed = { ...skyline, name: 'Renamed' } as GridViewCollectionDescriptor;
        expect(isSameCollectionPath(snap(playlist, skyline), snap(playlist, renamed))).toBe(true);
        expect(isSameCollectionPath(snap(playlist, skyline), snap(playlist))).toBe(false);
        expect(isSameCollectionPath(snap(playlist), { origin: 'search', stack: [playlist] })).toBe(false);
        expect(isSameCollectionPath(null, snap())).toBe(true);
        expect(isSameCollectionPath(null, snap(playlist))).toBe(false);
    });

    it('treats any depth under the same origin and root as the same visit', () => {
        expect(isSameCollectionVisit(snap(playlist), snap(playlist, skyline, polaris))).toBe(true);
        expect(isSameCollectionVisit(snap(playlist), snap(skyline))).toBe(false);
        expect(isSameCollectionVisit(snap(playlist), { origin: 'player', stack: [playlist] })).toBe(false);
        expect(isSameCollectionVisit(null, snap(playlist))).toBe(false);
    });
});

describe('projectNavigationTrail', () => {
    it('lists every layer bottom-up by position, duplicates included, keyed like the browse session', () => {
        expect(projectNavigationTrail(snap(playlist, polaris, skyline, polaris))).toEqual([
            { key: 'online:netease:playlist:root', name: 'playlist root', type: 'playlist' },
            { key: 'online:netease:artist:polaris', name: 'artist polaris', type: 'artist' },
            { key: 'online:netease:album:skyline', name: 'album skyline', type: 'album' },
            { key: 'online:netease:artist:polaris', name: 'artist polaris', type: 'artist' },
        ]);
    });

    it('is empty without an open stack and tolerates a missing name', () => {
        expect(projectNavigationTrail(null)).toEqual([]);
        expect(projectNavigationTrail(undefined)).toEqual([]);
        const nameless = { ...skyline, name: undefined } as unknown as GridViewCollectionDescriptor;
        expect(projectNavigationTrail(snap(nameless))).toEqual([{ key: 'online:netease:album:skyline', name: '', type: 'album' }]);
    });
});
