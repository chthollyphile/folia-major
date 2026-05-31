import { describe, expect, it } from 'vitest';
import { pickStableBuiltinAvatarImage, resolveCappellaAvatarUrl, type CappellaAvatarImage } from '@/components/visualizer/cappella/avatarImages';
import { resolveStoredCappellaTuning } from '@/hooks/useAppPreferences';
import type { CappellaTuning } from '@/types';

// test/unit/visualizer/cappellaAvatarSettings.test.ts
// Locks Cappella avatar source persistence defaults and source priority.
const avatars: CappellaAvatarImage[] = [
    { id: 'avatar-a', name: 'A', url: '/avatar-a.png' },
    { id: 'avatar-b', name: 'B', url: '/avatar-b.png' },
];

describe('Cappella avatar tuning', () => {
    it('defaults legacy stored tuning to cover avatar source', () => {
        expect(resolveStoredCappellaTuning({
            showEmoMessages: false,
            emojiPackSource: 'custom',
        })).toEqual({
            showEmoMessages: false,
            emojiPackSource: 'custom',
            avatarSource: 'cover',
        });
    });

    it('falls back to cover for an invalid stored avatar source', () => {
        expect(resolveStoredCappellaTuning({
            avatarSource: 'missing-source',
        } as unknown as Partial<CappellaTuning>).avatarSource).toBe('cover');
    });
});

describe('Cappella avatar URL resolution', () => {
    it('uses the cover when cover source has a cover URL', () => {
        expect(resolveCappellaAvatarUrl({
            avatarSource: 'cover',
            coverUrl: '/cover.jpg',
            avatarIndex: 0,
            side: 'left',
            avatars,
        })).toBe('/cover.jpg');
    });

    it('falls back to a stable built-in avatar when cover source has no cover URL', () => {
        expect(resolveCappellaAvatarUrl({
            avatarSource: 'cover',
            avatarIndex: 0,
            side: 'left',
            avatars,
        })).toBe('/avatar-a.png');
    });

    it('uses a stable built-in avatar for builtin source even when cover exists', () => {
        const resolved = resolveCappellaAvatarUrl({
            avatarSource: 'builtin',
            coverUrl: '/cover.jpg',
            avatarIndex: 1,
            side: 'left',
            avatars,
        });

        expect(avatars.map(avatar => avatar.url)).toContain(resolved);
        expect(resolved).not.toBe('/cover.jpg');
    });

    it('uses color blocks when color source is selected', () => {
        expect(resolveCappellaAvatarUrl({
            avatarSource: 'color',
            coverUrl: '/cover.jpg',
            avatarIndex: 1,
            side: 'right',
            avatars,
        })).toBeNull();
    });

    it('falls back to color blocks when built-in avatars are empty', () => {
        expect(resolveCappellaAvatarUrl({
            avatarSource: 'builtin',
            avatarIndex: 1,
            side: 'right',
            avatars: [],
        })).toBeNull();
    });

    it('keeps the right-side built-in avatar fixed for the same song seed', () => {
        const first = pickStableBuiltinAvatarImage(avatars, 0, 'right', 'song-a');
        const second = pickStableBuiltinAvatarImage(avatars, 8, 'right', 'song-a');

        expect(first).toEqual(second);
    });

    it('excludes the right-side built-in avatar from the left-side pool when possible', () => {
        const avatarPool: CappellaAvatarImage[] = [
            { id: 'avatar-a', name: 'A', url: '/avatar-a.png' },
            { id: 'avatar-b', name: 'B', url: '/avatar-b.png' },
            { id: 'avatar-c', name: 'C', url: '/avatar-c.png' },
        ];
        const rightAvatar = pickStableBuiltinAvatarImage(avatarPool, 8, 'right', 'song-b');
        const leftAvatars = Array.from({ length: 8 }, (_, index) => (
            pickStableBuiltinAvatarImage(avatarPool, index, 'left', 'song-b')
        ));

        expect(leftAvatars.every(avatar => avatar?.id !== rightAvatar?.id)).toBe(true);
    });
});
