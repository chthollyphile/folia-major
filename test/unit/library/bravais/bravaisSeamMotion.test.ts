import { describe, expect, it } from 'vitest';
import { bravaisPopMotion, bravaisRevealMotion, seamFlipTransform } from '@/library/suites/bravais/bravaisSeamMotion';
import { resolveSeamContentIdentity } from '@/library/suites/bravais/bravaisSeamTarget';
import type { BravaisLayer } from '@/library/suites/bravais/bravaisLayer';

// test/unit/library/bravais/bravaisSeamMotion.test.ts
// 缝里的动效词汇（设计稿 §7「缝内的过渡」）：翻牌绕的轴、弹出从锚点那一侧长出来、降低动效时只淡入淡出；
// 整条缝翻不翻的身份（首页各页签是同一套内容，换页签只翻中段）。

const layer = (key: string, surface: BravaisLayer['surface']) => ({ key, surface }) as BravaisLayer;

describe('seam motion vocabulary', () => {
    it('flips rows around X and columns / the whole strip around Y, with the wall perspective', () => {
        expect(seamFlipTransform('x', 90)).toBe('perspective(1400px) rotateX(90deg)');
        expect(seamFlipTransform('y', -90)).toBe('perspective(1400px) rotateY(-90deg)');
    });

    it('pops menus out of their anchor side and only fades them with reduced motion', () => {
        const above = bravaisPopMotion('above', false);
        expect(above.style).toMatchObject({ originY: 1 });
        expect(above.initial).toMatchObject({ opacity: 0, scale: 0.94, y: 8 });
        expect(above.exit).toMatchObject({ opacity: 0, pointerEvents: 'none' });
        const below = bravaisPopMotion('below', false);
        expect(below.style).toMatchObject({ originY: 0 });
        expect(below.initial).toMatchObject({ y: -8 });
        const reduced = bravaisPopMotion('above', true);
        expect(reduced.initial).toEqual({ opacity: 0 });
        expect(Object.keys(reduced.exit).sort()).toEqual(['opacity', 'pointerEvents', 'transition']);
        expect(bravaisRevealMotion(true).initial).toEqual({ opacity: 0 });
    });

    it('tells seam contents apart by layer key, home tabs included', () => {
        // 2026-10-09：首页换页签也整条翻（与原型一致）。
        expect(resolveSeamContentIdentity(layer('home:playlist', 'home'))).not.toBe(resolveSeamContentIdentity(layer('home:local', 'home')));
        expect(resolveSeamContentIdentity(layer('collection:a', 'collection'))).not.toBe(resolveSeamContentIdentity(layer('collection:b', 'collection')));
        expect(resolveSeamContentIdentity(layer('artist:a', 'artist'))).toBe('artist:a');
    });

    it('treats the pages of the online group as one seam content', () => {
        // 2026-11-22：在线组里换歌单 / 电台 / 探索 / 专辑只是二级切换，缝不整条翻。
        const online = resolveSeamContentIdentity(layer('home:playlist', 'home'));
        expect(resolveSeamContentIdentity(layer('home:radio', 'home'))).toBe(online);
        expect(resolveSeamContentIdentity(layer('home:albums', 'home'))).toBe(online);
        expect(resolveSeamContentIdentity(layer('home:explore', 'home'))).toBe(online);
        expect(resolveSeamContentIdentity(layer('home:folia', 'home'))).not.toBe(online);
        expect(resolveSeamContentIdentity(layer('home:navidrome', 'home'))).not.toBe(online);
        // 别的 surface 碰巧叫这个 key 也不算。
        expect(resolveSeamContentIdentity(layer('home:radio', 'collection'))).toBe('home:radio');
    });
});
