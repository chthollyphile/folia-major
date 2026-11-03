import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { computeBravaisFrame, wallHintSpan } from '@/library/suites/bravais/bravaisFrame';
import { availableLocalTabLabel, localWallHint, onlineWallHint } from '@/library/suites/bravais/bravaisEmptyWallHint';

// test/unit/library/bravais/bravaisEmptyWallHint.test.ts
// 首页空墙上的说明：什么时候给、写哪一条（未登录 / 登录过期 / 空本地曲库，提不提本地页签、导入文件夹），
// 以及它在屏幕上占的横向区间（缝两侧较宽的那一边，缝不在屏上时整个视口）。

/** 假的 t：键名加上插值参数，看得出用了哪条文案、交了什么。 */
const t = ((key: string, options?: Record<string, unknown>) => (
    options ? `${key} ${JSON.stringify(options)}` : key
)) as unknown as TFunction;

const guest = { accountView: 'guest' as const, needsRelogin: false, providerLabel: 'Netease' };

describe('onlineWallHint', () => {
    it('explains how to connect a guest and points at the local tab when there is one', () => {
        const hint = onlineWallHint(guest, 'Local', t);
        expect(hint?.title).toBe('libraryBravaisHome.wallHint.guestTitle');
        expect(hint?.body).toBe('libraryBravaisHome.wallHint.guestBodyWithLocal {"connect":"libraryBravaisHome.connect","local":"Local"}');
        expect(onlineWallHint(guest, null, t)?.body).toBe('libraryBravaisHome.wallHint.guestBody {"connect":"libraryBravaisHome.connect"}');
    });

    it('says the sign-in expired and names the platform', () => {
        const hint = onlineWallHint({ ...guest, needsRelogin: true }, 'Local', t);
        expect(hint?.title).toBe('libraryBravaisHome.wallHint.reloginTitle {"provider":"Netease"}');
        expect(hint?.body).toBe('libraryBravaisHome.wallHint.reloginBody {"connect":"libraryBravaisHome.connect"}');
    });

    it('gives no hint once there is an account (or while it resolves)', () => {
        expect(onlineWallHint({ ...guest, accountView: 'authenticated' }, 'Local', t)).toBeUndefined();
        expect(onlineWallHint({ ...guest, accountView: 'resolving' }, 'Local', t)).toBeUndefined();
        expect(onlineWallHint({ ...guest, accountView: 'accountless' }, 'Local', t)).toBeUndefined();
    });
});

describe('localWallHint', () => {
    it('points at the folder import only when the seam menu has it', () => {
        expect(localWallHint(true, t)).toEqual({
            title: 'libraryBravaisHome.wallHint.localTitle',
            body: 'libraryBravaisHome.wallHint.localBody {"action":"localMusic.importFolder"}',
        });
        expect(localWallHint(false, t)).toEqual({ title: 'libraryBravaisHome.wallHint.localTitle', body: undefined });
    });

    it('only names a local tab that can be opened', () => {
        expect(availableLocalTabLabel([{ key: 'local', label: 'Local', active: false, disabled: false }])).toBe('Local');
        expect(availableLocalTabLabel([{ key: 'local', label: 'Local', active: false, disabled: true }])).toBeNull();
        expect(availableLocalTabLabel([{ key: 'playlists', label: 'Playlists', active: true, disabled: false }])).toBeNull();
        expect(availableLocalTabLabel(undefined)).toBeNull();
    });
});

describe('wallHintSpan', () => {
    const view = { width: 1200, height: 800, scale: 0.5 };
    const frameAt = (centerX: number, anchorX: number | null, openWidth = 300, hidden = false) => computeBravaisFrame({
        center: { x: centerX, y: 0 }, view, anchorX, openWidth, contentWidth: 300, hidden,
    });

    it('takes the wider side of the seam, the right one on a tie', () => {
        // 缝在正中（600 ± 150）：两边一样宽，取右边。
        expect(wallHintSpan(frameAt(0, 0), view.width)).toEqual({ left: 750, width: 450 });
        // 墙往右拖了 200 世界 px（屏幕 100）：缝挪到 700，左边更宽。
        expect(wallHintSpan(frameAt(-200, 0), view.width)).toEqual({ left: 0, width: 550 });
    });

    it('uses the whole viewport when no seam is on screen', () => {
        expect(wallHintSpan(frameAt(0, null), view.width)).toEqual({ left: 0, width: 1200 });
        expect(wallHintSpan(frameAt(3000, 0), view.width)).toEqual({ left: 0, width: 1200 });
        expect(wallHintSpan(frameAt(0, 0, 0, true), view.width)).toEqual({ left: 0, width: 1200 });
    });
});
