import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Line } from '../../../../../types';
import { adjustLightnessForContrast } from '../../../../../utils/themeColorMath';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import { prepareWordColorMatchers } from '../../../wordColoring';
import { machiNeonGroup, type MachiBeatFrame } from '../../engine/beatFx';
import { resolveMachiFlicker, type MachiBoardTarget } from '../../engine/director';
import { MachiLedStrip } from '../../engine/ledStrip';
import { MachiLyricScreen } from '../../engine/lyricScreen';
import type { MachiColorBlend, MachiMaterials } from '../../engine/materials';
import { vivid } from '../../engine/palette';
import { context2d, createCanvas, createMachiMeasure } from '../../engine/signRaster';
import type { MachiSceneContent } from '../types';
import { KowloonHologram, resolveKowloonHologramText } from './hologram';
import { paintKowloonBarSign, paintKowloonSign, type KowloonSignRect, type KowloonSignStyle } from './kowloonSignPaint';
import type { KowloonPlacement, KowloonSignPlacement } from './street';

// src/components/visualizer/machi/scenes/kowloon/kowloonSigns.ts
// 城寨酒吧的招牌：酒吧楼面上的歌词大屏（engine/lyricScreen.ts，当前行逐字点亮）、屏幕下沿的 LED 跑马灯（这一句的
// 译文，没有译文时滚曲名、歌手）、巷子里的全息投影（下一句，hologram.ts）、酒吧门头的霓虹（曲名），以及一串
// 伸出楼面的店招（一块竖灯箱写歌手，其余是按 seed 挑的店名：霓虹或灯箱）、楼顶的「九龍城寨」、大排档的招牌。
// 店招都画进一张图集，按“稳定 / 两组会坏的灯管”分三种材质，各合成一个网格；坏的那两组时不时闪一阵、灭一下。

export interface KowloonSignPlacements {
    screen: KowloonPlacement;
    ticker: KowloonPlacement;
    barSign: KowloonPlacement;
    boards: KowloonSignPlacement[];
    hologram: { base: THREE.Vector3; panel: KowloonPlacement };
}

export interface KowloonSignFrame {
    songTime: number;
    ambientTime: number;
    delta: number;
    staticMode: boolean;
    chorus: number;
    audio: number;
    flicker: number;
    /** 人造光的亮度（白天弱）与白天程度（全息被日光冲淡）。 */
    artificial: number;
    daylight: number;
    beat: MachiBeatFrame;
}

/** 店名：竖招牌与横招牌各一池，有的带一行英文小字。 */
const VERTICAL_SHOPS: [string, string?][] = [
    ['義體診所', 'CYBER CLINIC'], ['夜總會', 'NIGHT CLUB'], ['麻雀館'], ['跌打'], ['大押'], ['旅館', 'HOTEL'],
    ['牙科', 'DENTAL'], ['電腦維修'], ['髮廊'], ['找換店'], ['義肢'], ['桑拿'],
];
const HORIZONTAL_SHOPS = ['冰室', '魚蛋粉', '卡拉OK', '當舖', '網吧', '雀館', '燒臘', '涼茶', '電子煙', '記憶交易'];
const NEON_COLORS = ['#ff4fb0', '#3fe8ff', '#ffb547', '#57ff9a', '#ff5a4a', '#b38bff'];
const BOX_STYLES: [string, string][] = [
    ['#f4efe2', '#c8282c'],
    ['#ffd23f', '#1c1c1c'],
    ['#d8262c', '#fff4d6'],
    ['#1f6fd1', '#ffffff'],
    ['#18a058', '#ffffff'],
];

/** 图集的像素密度（每米多少像素）：要读的字（门头、歌手、楼顶）密一点。 */
const PX_PER_METER = { fine: 300, shop: 220 } as const;
const ATLAS_WIDTH = 2048;
const ATLAS_PAD = 6;

/**
 * 图集招牌分几个网格（各一个材质）：group 是坏灯管那组（0 稳定，1、2 是两组会坏的灯管），beat 是霓虹随拍轮到的那组。
 * 稳定的招牌占了大半，按顺序轮流分进三组，免得随拍时整条街一起亮；两组坏灯管各自就是一组。
 */
const ATLAS_SLOTS = [
    { group: 0, beat: 0 },
    { group: 0, beat: 1 },
    { group: 0, beat: 2 },
    { group: 1, beat: 1 },
    { group: 2, beat: 2 },
] as const;

interface AtlasEntry {
    placement: KowloonPlacement;
    rect: KowloonSignRect;
    /** 0 稳定，1、2 是两组会坏的灯管。 */
    group: number;
    /** 要读的字（门头、歌手、楼顶）：图集里画得密一点。 */
    fine: boolean;
    paint: (context: CanvasRenderingContext2D, content: MachiSceneContent) => void;
}

/** 按行装箱：从高到矮排，一行放不下就换行。 */
const packAtlas = (sizes: { width: number; height: number }[]) => {
    const order = sizes.map((size, index) => ({ ...size, index })).sort((a, b) => b.height - a.height);
    const rects: KowloonSignRect[] = new Array(sizes.length);
    let x = ATLAS_PAD;
    let y = ATLAS_PAD;
    let row = 0;
    order.forEach(size => {
        if (x + size.width + ATLAS_PAD > ATLAS_WIDTH) {
            x = ATLAS_PAD;
            y += row + ATLAS_PAD;
            row = 0;
        }
        rects[size.index] = { x, y, width: size.width, height: size.height };
        x += size.width + ATLAS_PAD;
        row = Math.max(row, size.height);
    });
    return { rects, height: Math.ceil((y + row + ATLAS_PAD) / 4) * 4 };
};

/** 一块招牌面：平面网格，UV 映到图集里的一格。 */
const atlasFace = (placement: KowloonPlacement, rect: KowloonSignRect, atlasHeight: number) => {
    const geometry = new THREE.PlaneGeometry(placement.width, placement.height);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const u0 = rect.x / ATLAS_WIDTH;
    const u1 = (rect.x + rect.width) / ATLAS_WIDTH;
    const vTop = 1 - rect.y / atlasHeight;
    const vBottom = 1 - (rect.y + rect.height) / atlasHeight;
    for (let index = 0; index < uv.count; index += 1) {
        uv.setXY(index, u0 + uv.getX(index) * (u1 - u0), vBottom + uv.getY(index) * (vTop - vBottom));
    }
    geometry.rotateY(placement.rotationY);
    geometry.translate(placement.position.x, placement.position.y, placement.position.z);
    return geometry;
};

/** 屏幕下沿的跑马灯：这一句的译文；没有译文时滚曲名与歌手。 */
export const resolveKowloonTickerText = (target: MachiBoardTarget, lines: readonly Line[], song: { title: string; artist: string }) => {
    const current = target.kind === 'line' ? lines[target.index] : undefined;
    if (current?.translation?.trim()) return `◆ ${current.translation.trim()}   `;
    return `♪ ${song.title || 'KOWLOON'}${song.artist ? ` — ${song.artist}` : ''}   ◆   九龍城寨   ◆   OPEN ALL NIGHT   ◆   `;
};

export class KowloonSigns {
    readonly group = new THREE.Group();
    private readonly screen: MachiLyricScreen;
    private readonly ticker: MachiLedStrip;
    private readonly hologram: KowloonHologram;
    private readonly canvas: HTMLCanvasElement;
    private readonly texture: THREE.CanvasTexture;
    private readonly atlasMaterials: THREE.MeshBasicMaterial[];
    private readonly entries: AtlasEntry[];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private content: MachiSceneContent | null = null;
    private boardTarget: MachiBoardTarget | null = null;
    private lines: readonly Line[] = [];
    private tickerDirty = true;

    constructor(materials: MachiMaterials, private readonly blend: MachiColorBlend, placements: KowloonSignPlacements, private readonly seed: string | number) {
        this.group.name = 'Signs';
        const { screen, ticker, hologram } = placements;
        this.screen = new MachiLyricScreen(materials, blend, screen.width, screen.height);
        this.group.add(this.screen.createFace(screen.position, screen.rotationY, 'Bar/screen'));
        this.ticker = new MachiLedStrip(materials, blend, ticker.width, ticker.height, 9);
        this.group.add(this.ticker.createFace(ticker.position, ticker.rotationY, 'Bar/ticker'));
        this.hologram = new KowloonHologram(materials, hologram.base, hologram.panel);
        this.group.add(this.hologram.group);

        // 店招：按 seed 给每块挑店名、写法（霓虹 / 灯箱）、颜色、坏不坏。
        const random = createVisualizerRng(`kowloon:signs:${seed}`);
        const verticalPool = [...VERTICAL_SHOPS];
        const horizontalPool = [...HORIZONTAL_SHOPS];
        const take = <T>(pool: T[]) => pool.splice(Math.floor(random() * pool.length), 1)[0]!;
        const neon = (): KowloonSignStyle => {
            const color = NEON_COLORS[Math.floor(random() * NEON_COLORS.length)]!;
            return { kind: 'neon', color, border: random() < 0.5 ? color : NEON_COLORS[Math.floor(random() * NEON_COLORS.length)]! };
        };
        const box = (): KowloonSignStyle => {
            const [background, ink] = BOX_STYLES[Math.floor(random() * BOX_STYLES.length)]!;
            return { kind: 'box', background, ink };
        };
        const entries: Omit<AtlasEntry, 'rect'>[] = [];
        entries.push({
            placement: placements.barSign,
            group: 0,
            fine: true,
            paint: (context, content) => paintKowloonBarSign(context, this.rectOf(0), {
                font: content.font,
                title: content.song.title || content.song.album || 'KOWLOON',
                neon: content.palette.neon,
                glass: '#3fe8ff',
                mark: '#ff4fb0',
            }),
        });
        placements.boards.forEach(board => {
            const index = entries.length;
            if (board.role === 'artist') {
                entries.push({
                    placement: board,
                    group: 0,
                    fine: true,
                    paint: (context, content) => {
                        const background = '#f4efe2';
                        const ink = adjustLightnessForContrast(vivid(content.palette.brand[0], 0.62, 0.3, 0.46), background, 4.5);
                        paintKowloonSign(context, this.rectOf(index), {
                            font: content.font,
                            text: content.song.artist || content.song.album || content.song.title || '歌手',
                            vertical: true,
                            style: { kind: 'box', background, ink },
                        });
                    },
                });
                return;
            }
            let text: string;
            let caption: string | undefined;
            let style: KowloonSignStyle;
            if (board.role === 'billboard') {
                text = '九龍城寨';
                style = { kind: 'neon', color: '#ff4a5a', border: '#3fe8ff' };
            } else if (board.role === 'stall') {
                text = '大牌檔';
                style = { kind: 'box', background: '#f3ead6', ink: '#c6282c' };
            } else if (board.vertical) {
                [text, caption] = take(verticalPool);
                style = random() < 0.55 ? neon() : box();
            } else {
                text = take(horizontalPool);
                style = random() < 0.6 ? neon() : box();
            }
            const group = board.role === 'shop' && style.kind === 'neon' && random() < 0.45 ? 1 + Math.floor(random() * 2) : 0;
            entries.push({
                placement: board,
                group,
                fine: board.role === 'billboard',
                paint: context => paintKowloonSign(context, this.rectOf(index), { font: { stack: this.content!.font.stack, weight: 800 }, text, vertical: board.vertical, style, caption }),
            });
        });
        const packed = packAtlas(entries.map(entry => {
            const density = entry.fine ? PX_PER_METER.fine : PX_PER_METER.shop;
            return { width: Math.round(entry.placement.width * density), height: Math.round(entry.placement.height * density) };
        }));
        this.entries = entries.map((entry, index) => ({ ...entry, rect: packed.rects[index]! }));
        this.canvas = createCanvas(ATLAS_WIDTH, packed.height);
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.atlasMaterials = ATLAS_SLOTS.map(slot => {
            const material = materials.track(new THREE.MeshBasicMaterial({ map: this.texture }));
            material.name = `machi:glow:neon${slot.group}-${slot.beat}`;
            return material;
        });
        const faces: THREE.BufferGeometry[][] = ATLAS_SLOTS.map(() => []);
        let steady = 0;
        this.entries.forEach(entry => {
            const slot = entry.group === 0 ? steady++ % 3 : ATLAS_SLOTS.findIndex(candidate => candidate.group === entry.group);
            faces[slot]!.push(atlasFace(entry.placement, entry.rect, packed.height));
        });
        this.atlasMaterials.forEach((material, slotIndex) => {
            const slotFaces = faces[slotIndex]!;
            if (slotFaces.length === 0) return;
            const merged = mergeGeometries(slotFaces, false)!;
            slotFaces.forEach(face => face.dispose());
            this.geometries.push(merged);
            const result = new THREE.Mesh(merged, material);
            const slot = ATLAS_SLOTS[slotIndex]!;
            result.name = `Neon/${slot.group}-${slot.beat}`;
            this.group.add(result);
        });
    }

    private rectOf(index: number) {
        return this.entries[index]!.rect;
    }

    /** 换歌 / 换主题：重画图集里所有的招牌、屏幕的字面。 */
    setContent(content: MachiSceneContent) {
        this.content = content;
        const context = context2d(this.canvas);
        context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.entries.forEach(entry => entry.paint(context, content));
        this.texture.needsUpdate = true;
        const { palette, song, font } = content;
        this.screen.setContent({
            palette,
            font,
            measure: createMachiMeasure(font),
            matchers: prepareWordColorMatchers(content.theme.wordColors),
            cardTitle: `♪ ${song.title || 'KOWLOON'}`,
            cardSubtitle: song.artist || song.album || '',
        });
        this.ticker.invalidate();
        this.hologram.invalidate();
        this.tickerDirty = true;
    }

    showBoard(target: MachiBoardTarget, lines: readonly Line[], immediate: boolean, showText = true) {
        this.lines = lines;
        this.boardTarget = target;
        this.screen.show(target, lines, immediate, showText);
        this.tickerDirty = true;
        const content = this.content;
        if (content) {
            const text = resolveKowloonHologramText(showText ? target : { kind: 'card' }, lines, content.song);
            this.hologram.setText(text, content.font, immediate);
        }
    }

    preheat(target: MachiBoardTarget, lines: readonly Line[], showText: boolean) {
        this.screen.preheat(target, lines, showText);
    }

    update(frame: KowloonSignFrame) {
        const content = this.content;
        if (!content) return;
        this.screen.update(frame);
        const chorus = this.screen.chorus;
        if (this.tickerDirty && this.boardTarget) {
            this.tickerDirty = false;
            this.ticker.setText(resolveKowloonTickerText(this.boardTarget, this.lines, content.song), content.font);
        }
        this.ticker.update({ delta: frame.delta, staticMode: frame.staticMode, speed: 0.8 + 0.4 * chorus, audio: frame.audio });
        // 霓虹：白天也亮着，只是被日光压下去；两组坏灯管时不时闪一阵，偶尔整个灭掉。
        // 霓虹随拍（智能动感模式）：招牌按 ATLAS_SLOTS 分在三组里轮流慢慢亮起（坏灯管灭着的时候照样灭着）。
        const neon = Math.pow(frame.artificial, 1.4) * (1 + 0.1 * chorus);
        const steady = neon * (0.93 + 0.07 * frame.flicker);
        const broken = (salt: string, offset: number) => {
            if (frame.staticMode) return neon;
            const flicker = resolveMachiFlicker(frame.ambientTime + offset, `${this.seed}:${salt}`, 1.8);
            return neon * (flicker < 1 ? 0.12 + 0.3 * (flicker - 0.5) : 1);
        };
        const levels = [steady, broken('neonA', 1.3), broken('neonB', 3.7)];
        this.atlasMaterials.forEach((material, index) => {
            const slot = ATLAS_SLOTS[index]!;
            material.color.setScalar(levels[slot.group]! * machiNeonGroup(frame.beat, slot.beat));
        });
        this.hologram.update({
            time: frame.ambientTime,
            delta: frame.delta,
            staticMode: frame.staticMode,
            level: (0.3 + 0.7 * (1 - frame.daylight)) * (0.9 + 0.1 * frame.flicker) * (1 + 0.15 * chorus),
            color: this.blend.get('holo'),
        });
    }

    get busy() {
        return this.screen.busy || this.hologram.busy;
    }

    dispose() {
        this.screen.dispose();
        this.ticker.dispose();
        this.hologram.dispose();
        this.texture.dispose();
        this.geometries.forEach(geometry => geometry.dispose());
    }
}
