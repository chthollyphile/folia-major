import { describe, expect, it } from 'vitest';
import { resolveCapsuleQuickActions } from '../../../src/components/floating-player/capsuleQuickActionSelection';
import {
    CAPSULE_ISLAND_MAX,
    DEFAULT_CAPSULE_ISLAND,
    normalizeCapsuleIsland,
    placePlayerControl,
    type PlayerControlLayout,
} from '../../../src/types/playerControlSlots';

// 胶囊上的控件：浮岛按用户摆的画（去掉槽位里的、此刻用不了的、手指点开时的音量，放不下从末尾截），
// 以及槽位与浮岛共用一个控件池的摆放规则。

const always = () => true;

describe('resolveCapsuleQuickActions', () => {
    it('按用户摆的顺序画，去掉槽位里已有的', () => {
        expect(resolveCapsuleQuickActions({
            island: ['like', 'queue', 'loop', 'volume'],
            slots: ['loop', 'lyrics-timeline'],
            isAvailable: always,
        })).toEqual(['like', 'queue', 'volume']);
    });

    it('此刻用不了的不画，截断在去掉之后', () => {
        expect(resolveCapsuleQuickActions({
            island: ['like', 'queue', 'shuffle', 'volume'],
            slots: [],
            isAvailable: id => id !== 'like',
            limit: 2,
        })).toEqual(['queue', 'shuffle']);
    });

    it('手指点开的那一排不放音量', () => {
        const input = { island: ['volume', 'like'] as const, slots: [], isAvailable: always };
        expect(resolveCapsuleQuickActions(input)).toEqual(['volume', 'like']);
        expect(resolveCapsuleQuickActions({ ...input, touch: true })).toEqual(['like']);
    });
});

describe('normalizeCapsuleIsland', () => {
    it('没存过用默认，去掉槽位里的', () => {
        expect(normalizeCapsuleIsland(null, ['like', 'loop'])).toEqual(DEFAULT_CAPSULE_ISLAND.filter(id => id !== 'like'));
    });

    it('认不得的、重复的去掉，多的截掉', () => {
        expect(normalizeCapsuleIsland(['like', 'nope', 'like', 3, 'queue'], [])).toEqual(['like', 'queue']);
        const many = ['prev', 'next', 'shuffle', 'like', 'volume', 'queue', 'song-wall', 'sleep-timer', 'locate', 'mark-moment'];
        expect(normalizeCapsuleIsland(many, [])).toHaveLength(CAPSULE_ISLAND_MAX);
    });

    it('空数组是用户把浮岛清空了，不回默认', () => {
        expect(normalizeCapsuleIsland([], [])).toEqual([]);
    });
});

describe('placePlayerControl', () => {
    const layout: PlayerControlLayout = { primary: 'loop', secondary: 'lyrics-timeline', island: ['like', 'shuffle', 'volume'] };

    it('池子里的放进槽位，原来的回池子', () => {
        expect(placePlayerControl(layout, 'queue', { kind: 'slot', slot: 'primary' }))
            .toEqual({ ...layout, primary: 'queue' });
    });

    it('浮岛上的放进槽位，原来的换到浮岛那个位置', () => {
        expect(placePlayerControl(layout, 'shuffle', { kind: 'slot', slot: 'secondary' }))
            .toEqual({ ...layout, secondary: 'shuffle', island: ['like', 'lyrics-timeline', 'volume'] });
    });

    it('另一个槽位的放过来，两个槽位互换', () => {
        expect(placePlayerControl(layout, 'loop', { kind: 'slot', slot: 'secondary' }))
            .toEqual({ ...layout, primary: 'lyrics-timeline', secondary: 'loop' });
    });

    it('放回原处不算一步', () => {
        expect(placePlayerControl(layout, 'loop', { kind: 'slot', slot: 'primary' })).toBeNull();
        expect(placePlayerControl(layout, 'shuffle', { kind: 'island', index: 1 })).toBeNull();
    });

    it('浮岛里挪位置、从池子里插进去', () => {
        expect(placePlayerControl(layout, 'volume', { kind: 'island', index: 0 })?.island).toEqual(['volume', 'like', 'shuffle']);
        expect(placePlayerControl(layout, 'like', { kind: 'island', index: 2 })?.island).toEqual(['shuffle', 'volume', 'like']);
        expect(placePlayerControl(layout, 'queue', { kind: 'island', index: 1 })?.island).toEqual(['like', 'queue', 'shuffle', 'volume']);
    });

    it('浮岛满了，池子里的插不进去，浮岛里挪位置照样行', () => {
        const full: PlayerControlLayout = {
            ...layout,
            island: ['like', 'shuffle', 'volume', 'queue', 'prev', 'next', 'locate', 'sleep-timer'],
        };
        expect(placePlayerControl(full, 'song-wall', { kind: 'island', index: 0 })).toBeNull();
        expect(placePlayerControl(full, 'sleep-timer', { kind: 'island', index: 0 })?.island[0]).toBe('sleep-timer');
    });

    it('槽位里的不能插进浮岛（槽位会空），只能和浮岛上的互换', () => {
        expect(placePlayerControl(layout, 'loop', { kind: 'island', index: 0 })).toBeNull();
        expect(placePlayerControl(layout, 'loop', { kind: 'island-swap', index: 2 }))
            .toEqual({ ...layout, primary: 'volume', island: ['like', 'shuffle', 'loop'] });
    });

    it('只有浮岛上的能放回池子', () => {
        expect(placePlayerControl(layout, 'like', { kind: 'pool' })?.island).toEqual(['shuffle', 'volume']);
        expect(placePlayerControl(layout, 'loop', { kind: 'pool' })).toBeNull();
        expect(placePlayerControl(layout, 'queue', { kind: 'pool' })).toBeNull();
    });
});
