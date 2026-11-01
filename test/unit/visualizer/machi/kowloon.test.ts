import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MACHI_BASE } from '@/components/visualizer/machi/engine/geometry/plinth';
import type { MachiMaterials } from '@/components/visualizer/machi/engine/materials';
import { buildKowloonBlocks } from '@/components/visualizer/machi/scenes/kowloon/blocks';
import { resolveKowloonHologramText } from '@/components/visualizer/machi/scenes/kowloon/hologram';
import { resolveKowloonVerticalText } from '@/components/visualizer/machi/scenes/kowloon/kowloonSignPaint';
import { resolveKowloonTickerText } from '@/components/visualizer/machi/scenes/kowloon/kowloonSigns';
import {
    BLOCKS,
    HANGING_SIGNS,
    HOLOGRAM,
    KOWLOON_VIEW,
    leftFaceAt,
    POLE,
    SCREEN,
    STALL,
} from '@/components/visualizer/machi/scenes/kowloon/layout';
import { buildKowloonStreet, kowloonScreenFront, kowloonWindowAvoid } from '@/components/visualizer/machi/scenes/kowloon/street';
import type { Line } from '@/types';

// test/unit/visualizer/machi/kowloon.test.ts
// 城寨酒吧：全息写下一句（跳过空行，没有下一句用译文，曲名卡写曲名与歌手）、跑马灯写译文或曲名、竖招牌的竖排与
// 转写；楼都在底座里、互不重叠，招牌从楼面伸出来，歌词屏朝着默认镜头，全息、大排档、电线杆都在巷子里；
// 楼面上的水管不压歌词屏、招牌、酒吧门面、楼脚的铺面与窗外的东西，晾的衣服一件挨一件不叠，晾衫竹、冷气机、铁窗笼互不相插。

const line = (text: string, start: number, extra: Partial<Line> = {}): Line => ({
    words: [{ text, startTime: start, endTime: start + 2 }],
    startTime: start,
    endTime: start + 2,
    fullText: text,
    ...extra,
});

const song = { title: '迟到的雨', artist: '城寨乐队' };

describe('resolveKowloonHologramText', () => {
    const lines = [line('在城市尽头等', 0, { translation: 'waiting at the edge' }), line('  ', 3), line('一场迟到的雨', 5, { translation: 'a late rain' })];

    it('shows the next non-empty line', () => {
        expect(resolveKowloonHologramText({ kind: 'line', index: 0 }, lines, song)).toEqual({ label: 'NEXT', text: '一场迟到的雨' });
    });

    it('falls back to the translation on the last line, then to the title', () => {
        expect(resolveKowloonHologramText({ kind: 'line', index: 2 }, lines, song)).toEqual({ label: 'TRANSLATION', text: 'a late rain' });
        expect(resolveKowloonHologramText({ kind: 'line', index: 0 }, [line('最后', 0)], song)).toEqual({ label: 'NOW PLAYING', text: '迟到的雨 — 城寨乐队' });
        expect(resolveKowloonHologramText({ kind: 'card' }, lines, { title: '', artist: '' })).toEqual({ label: 'NOW PLAYING', text: 'KOWLOON' });
    });
});

describe('resolveKowloonTickerText', () => {
    it('scrolls the translation of the current line, otherwise the credits', () => {
        const lines = [line('在城市尽头等', 0, { translation: 'waiting' }), line('雨', 3)];
        expect(resolveKowloonTickerText({ kind: 'line', index: 0 }, lines, song)).toContain('waiting');
        const credits = resolveKowloonTickerText({ kind: 'line', index: 1 }, lines, song);
        expect(credits).toContain('迟到的雨 — 城寨乐队');
        expect(resolveKowloonTickerText({ kind: 'card' }, lines, song)).toBe(credits);
    });
});

describe('resolveKowloonVerticalText', () => {
    it('stacks CJK and short Latin names, and turns long Latin names sideways', () => {
        expect(resolveKowloonVerticalText('義體 診所')).toEqual({ mode: 'stack', glyphs: ['義', '體', '診', '所'] });
        expect(resolveKowloonVerticalText('Aimer')).toEqual({ mode: 'stack', glyphs: ['A', 'i', 'm', 'e', 'r'] });
        expect(resolveKowloonVerticalText('Probe Ensemble')).toEqual({ mode: 'rotate', text: 'Probe Ensemble' });
    });

    it('cuts long CJK names with an ellipsis', () => {
        const result = resolveKowloonVerticalText('一二三四五六七八九十');
        expect(result).toEqual({ mode: 'stack', glyphs: ['一', '二', '三', '四', '五', '六', '七', '…'] });
    });
});

describe('kowloon layout', () => {
    const half = MACHI_BASE.half;
    const inside = (x: number, y: number, z: number) => BLOCKS.some(block => x > block.x0 && x < block.x1 && z > block.z0 && z < block.z1 && y < block.height);

    it('keeps the blocks on the base without overlapping', () => {
        BLOCKS.forEach(block => {
            expect(block.x0).toBeGreaterThanOrEqual(-half);
            expect(block.x1).toBeLessThanOrEqual(half);
            expect(block.z0).toBeGreaterThanOrEqual(-half);
            expect(block.z1).toBeLessThanOrEqual(half);
        });
        BLOCKS.forEach((a, i) => BLOCKS.slice(i + 1).forEach(b => {
            const overlap = a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
            expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
        }));
    });

    it('hangs every sign off a wall into the open alley', () => {
        HANGING_SIGNS.forEach((sign, index) => {
            if (sign.axis === 'x') expect(sign.wall, `sign ${index}`).toBeCloseTo(leftFaceAt(sign.at), 5);
            const tip = sign.axis === 'x' ? [sign.tip, sign.at] : [sign.at, sign.tip];
            expect(inside(tip[0]!, (sign.y0 + sign.y1) / 2, tip[1]!), `sign ${index} tip`).toBe(false);
            expect(Math.abs(tip[0]!)).toBeLessThan(half);
            expect(Math.abs(tip[1]!)).toBeLessThan(half);
        });
    });

    it('turns the lyric screen towards the default camera and keeps the alley pieces out of the blocks', () => {
        expect(Math.abs(KOWLOON_VIEW.azimuth) * 180 / Math.PI).toBeLessThanOrEqual(30);
        expect(SCREEN.width).toBeGreaterThan(4);
        const bar = BLOCKS.find(block => block.name === 'B1')!;
        expect(SCREEN.z).toBeGreaterThan(bar.z1);
        expect(SCREEN.x - SCREEN.width / 2).toBeGreaterThanOrEqual(bar.x0);
        expect(SCREEN.x + SCREEN.width / 2).toBeLessThanOrEqual(bar.x1);
        expect(inside(HOLOGRAM.x, 1, HOLOGRAM.z)).toBe(false);
        expect(inside(POLE.x, 1, POLE.z)).toBe(false);
        expect(inside((STALL.x0 + STALL.x1) / 2, 1, (STALL.z0 + STALL.z1) / 2)).toBe(false);
    });
});

describe('kowloon facades', () => {
    const material = new THREE.MeshBasicMaterial();
    const materials = { toon: () => material, glow: () => material, track: <T>(value: T) => value, product: material } as unknown as MachiMaterials;
    const seeds = Array.from({ length: 24 }, (_, index) => `song-${index}`);
    const build = (seed: string) => {
        const street = buildKowloonStreet(materials, seed);
        const blocks = buildKowloonBlocks(materials, seed, kowloonWindowAvoid(), [...street.signBoxes, kowloonScreenFront()], street.footing);
        blocks.group.updateMatrixWorld(true);
        return { street, blocks };
    };
    const named = (root: THREE.Object3D, name: string) => {
        const boxes: THREE.Box3[] = [];
        root.traverse(object => {
            if (object.name === name) boxes.push(new THREE.Box3().setFromObject(object));
        });
        return boxes;
    };
    // 两个盒子相交（各往里收 1 mm，只是贴着不算）。
    const overlap = (a: THREE.Box3, b: THREE.Box3) => a.clone().expandByScalar(-0.001).intersectsBox(b.clone().expandByScalar(-0.001));

    it('keeps the drainpipes off the lyric screen, the signs, the bar front, the shopfronts and the window clutter', () => {
        const bar = BLOCKS.find(block => block.hollow)!;
        const opening = new THREE.Box3(new THREE.Vector3(bar.hollow!.x0, 0, bar.z1 - 0.05), new THREE.Vector3(bar.hollow!.x1, bar.hollow!.y1, bar.z1 + 0.5));
        seeds.forEach(seed => {
            const { street, blocks } = build(seed);
            const pipes = named(blocks.group, 'Pipe');
            expect(pipes.length).toBeGreaterThan(10);
            const keepOut = [...street.signBoxes, kowloonScreenFront(), opening, ...street.footing];
            pipes.forEach(pipe => keepOut.forEach(box => expect(overlap(pipe, box), seed).toBe(false)));
            // 也不穿过冷气机、铁窗笼、加建、晾衫竹。
            const outward = ['AC', 'Cage', 'Addition', 'Bamboo'].flatMap(name => named(blocks.group, name));
            pipes.forEach(pipe => outward.forEach(box => expect(overlap(pipe, box), seed).toBe(false)));
        });
    });

    it('hangs the laundry side by side and keeps the poles, air conditioners and window cages apart', () => {
        const unit = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
        const matrix = new THREE.Matrix4();
        seeds.forEach(seed => {
            const { blocks } = build(seed);
            const pieces = Array.from({ length: blocks.clothes.count }, (_, index) => {
                blocks.clothes.getMatrixAt(index, matrix);
                return unit.clone().applyMatrix4(matrix);
            });
            expect(pieces.length).toBeGreaterThan(10);
            pieces.forEach((a, index) => pieces.slice(index + 1).forEach(b => expect(overlap(a, b), seed).toBe(false)));
            // 竹竿与衣服、冷气机、铁窗笼彼此不碰（同一样东西自己的几块除外）。
            const poles = named(blocks.group, 'Bamboo');
            const units = named(blocks.group, 'AC');
            const cages = named(blocks.group, 'Cage');
            poles.forEach((pole, index) => [...poles.slice(index + 1), ...units, ...cages].forEach(other => expect(overlap(pole, other), seed).toBe(false)));
            pieces.forEach(piece => [...units, ...cages].forEach(other => expect(overlap(piece, other), seed).toBe(false)));
            units.forEach(unit => cages.forEach(cage => expect(overlap(unit, cage), seed).toBe(false)));
        });
    });
});
