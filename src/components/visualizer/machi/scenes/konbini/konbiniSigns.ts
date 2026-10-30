import * as THREE from 'three';
import type { Line, Theme } from '../../../../../types';
import { prepareWordColorMatchers } from '../../../wordColoring';
import type { MachiSongContext } from '../../createMachiRuntime';
import { machiLightboxGroup, machiNeonGroup, type MachiBeatFrame } from '../../engine/beatFx';
import { resolveMachiTickerText, type MachiBoardTarget } from '../../engine/director';
import { MachiLedStrip } from '../../engine/ledStrip';
import { MachiLyricScreen } from '../../engine/lyricScreen';
import type { MachiColorBlend, MachiMaterials } from '../../engine/materials';
import type { MachiPalette } from '../../engine/palette';
import { createCanvas, createMachiMeasure, type MachiFont } from '../../engine/signRaster';
import { BOARD, DEG, STORE } from './layout';
import type { KonbiniPlacement } from './props';
import {
    paintKonbiniAFrame,
    paintKonbiniFascia,
    paintKonbiniNeon,
    paintKonbiniPoster,
    paintKonbiniPylon,
    paintKonbiniRoofLogo,
} from './konbiniSignPaint';

// src/components/visualizer/machi/scenes/konbini/konbiniSigns.ts
// 便利店的招牌：屋顶三面广告屏（engine/lyricScreen.ts，当前行逐字点亮）、右面店招上的 LED 跑马灯（engine/ledStrip.ts，
// 下一句 / 译文）、前面店招（主题图标 logo + 曲名当店名）、立柱灯箱、玻璃海报（歌手、专辑）、窗内霓虹图标、
// 广告塔顶的屋顶 logo、门口 A 字立牌（主题名）。颜色、图标、字体都从主题来；牌面贴图在换行 / 换歌 / 换主题时重画，
// 每帧只改 uniform 与材质亮度。

export interface KonbiniSignPlacements {
    boardFaces: { position: THREE.Vector3; rotationY: number }[];
    fasciaFaces: { position: THREE.Vector3; rotationY: number; width: number; height: number }[];
    pylonFaces: KonbiniPlacement[];
    aFrameFaces: (KonbiniPlacement & { lean?: number })[];
    boardLid: { center: THREE.Vector3; shape: THREE.Vector2[]; topY: number };
}

export interface KonbiniSignContent {
    song: MachiSongContext;
    theme: Theme;
    palette: MachiPalette;
    font: MachiFont;
    /** 主题图标（已加载、已规范化的名字），可能是空的。 */
    icons: string[];
    fallbacks: readonly string[];
}

export interface KonbiniSignFrame {
    songTime: number;
    ambientTime: number;
    delta: number;
    staticMode: boolean;
    chorus: number;
    audio: number;
    flicker: number;
    beat: MachiBeatFrame;
}

const canvasTexture = (canvas: HTMLCanvasElement, anisotropy = 4) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
};

const placedPlane = (material: THREE.Material, width: number, height: number, position: THREE.Vector3, rotationY: number, name: string) => {
    const result = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    result.name = name;
    result.position.copy(position);
    result.rotation.y = rotationY;
    return result;
};

export class KonbiniSigns {
    readonly group = new THREE.Group();
    private readonly screen: MachiLyricScreen;
    private readonly led: MachiLedStrip;
    private boardTarget: MachiBoardTarget | null = null;
    private readonly statics: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshBasicMaterial | THREE.MeshToonMaterial; level: number }[] = [];
    private readonly fascia;
    private readonly pylon;
    private readonly posters;
    private readonly neon;
    private readonly aFrame;
    private readonly roofLogo;
    private readonly roofCorners: { x: number; y: number }[];
    private content: KonbiniSignContent | null = null;
    private lines: readonly Line[] = [];

    constructor(materials: MachiMaterials, blend: MachiColorBlend, placements: KonbiniSignPlacements) {
        this.group.name = 'Signs';
        this.screen = new MachiLyricScreen(materials, blend, BOARD.faceWidth - 0.14, BOARD.faceHeight - 0.12);
        placements.boardFaces.forEach((face, index) => {
            this.group.add(this.screen.createFace(face.position, face.rotationY, `Board/face${index}`));
        });

        // 前面店招、右面 LED。
        const fasciaFront = placements.fasciaFaces[0]!;
        this.fascia = this.staticSign(materials, 1600, Math.round(1600 * fasciaFront.height / fasciaFront.width), 0.78, 'basic');
        this.group.add(placedPlane(this.fascia.material, fasciaFront.width, fasciaFront.height, fasciaFront.position, fasciaFront.rotationY, 'Fascia/front'));
        const fasciaRight = placements.fasciaFaces[1]!;
        this.led = new MachiLedStrip(materials, blend, fasciaRight.width, fasciaRight.height);
        this.group.add(this.led.createFace(fasciaRight.position, fasciaRight.rotationY, 'Fascia/led'));

        // 立柱灯箱两面。
        const pylonFace = placements.pylonFaces[0]!;
        this.pylon = this.staticSign(materials, 384, Math.round(384 * pylonFace.height / pylonFace.width), 0.95, 'basic');
        placements.pylonFaces.forEach((face, index) => {
            this.group.add(placedPlane(this.pylon.material, face.width, face.height, face.position, face.rotationY, `Pylon/face${index}`));
        });

        // 玻璃海报：前面左段玻璃后面两张。
        this.posters = [0, 1].map(index => {
            const sign = this.staticSign(materials, 256, 364, 0.95, 'basic');
            const position = new THREE.Vector3(-4.05 + index * 0.72, 1.62, STORE.z1 - 0.075);
            this.group.add(placedPlane(sign.material, 0.56, 0.8, position, 0, `Poster${index}`));
            return sign;
        });

        // 窗内霓虹：右面玻璃后面，朝外。
        this.neon = this.staticSign(materials, 256, 256, 1.6, 'additive');
        this.group.add(placedPlane(this.neon.material, 0.86, 0.86, new THREE.Vector3(STORE.x1 - 0.1, 1.55, -1.95), Math.PI / 2, 'Neon'));

        // 广告塔顶的屋顶 logo：形状坐标就是 UV（米），贴图按外接正方形映射过去。
        const lid = placements.boardLid;
        const reach = Math.max(...lid.shape.map(point => point.length())) * 1.02;
        this.roofLogo = this.staticSign(materials, 512, 512, 1, 'toon');
        this.roofLogo.texture.repeat.set(1 / (2 * reach), 1 / (2 * reach));
        this.roofLogo.texture.offset.set(0.5, 0.5);
        (this.roofLogo.material as THREE.MeshToonMaterial).emissive.setScalar(0.32);
        (this.roofLogo.material as THREE.MeshToonMaterial).emissiveMap = this.roofLogo.texture;
        this.roofCorners = lid.shape.map(point => ({ x: (point.x / (2 * reach) + 0.5) * 512, y: (0.5 - point.y / (2 * reach)) * 512 }));
        const logoGeometry = new THREE.ShapeGeometry(new THREE.Shape(lid.shape));
        logoGeometry.rotateX(-Math.PI / 2);
        const logo = new THREE.Mesh(logoGeometry, this.roofLogo.material);
        logo.name = 'Board/roofLogo';
        logo.position.set(lid.center.x, lid.topY + 0.004, lid.center.z);
        logo.receiveShadow = true;
        this.group.add(logo);

        // 门口 A 字立牌。
        const aFace = placements.aFrameFaces[0]!;
        this.aFrame = this.staticSign(materials, 256, Math.round(256 * aFace.height / aFace.width), 1, 'toon');
        const aMesh = placedPlane(this.aFrame.material, aFace.width, aFace.height, aFace.position, aFace.rotationY, 'AFrame/face');
        aMesh.rotateX(-(aFace.lean ?? 12 * DEG));
        this.group.add(aMesh);
    }

    /** 一块静态招牌：一张 canvas 贴图 + 材质（自发光、加色或受光）。 */
    private staticSign(materials: MachiMaterials, width: number, height: number, level: number, kind: 'basic' | 'additive' | 'toon') {
        const canvas = createCanvas(width, height);
        const texture = canvasTexture(canvas);
        const material = kind === 'toon'
            ? materials.track(new THREE.MeshToonMaterial({ map: texture, gradientMap: materials.gradient }))
            : materials.track(new THREE.MeshBasicMaterial({
                map: texture,
                transparent: kind === 'additive',
                blending: kind === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
                depthWrite: kind !== 'additive',
            }));
        if (material instanceof THREE.MeshBasicMaterial) material.color.setScalar(level);
        const sign = { canvas, texture, material, level };
        this.statics.push(sign);
        return sign;
    }

    /** 换歌 / 换主题：重画所有静态招牌，牌面按新颜色重画。 */
    setContent(content: KonbiniSignContent) {
        this.content = content;
        const { palette, font, song, fallbacks } = content;
        const icon = (index: number) => content.icons.length ? content.icons[index % content.icons.length] : fallbacks[index % fallbacks.length];
        const title = song.title || song.album || 'KONBINI';
        paintKonbiniFascia(this.fascia.canvas, { font, title, icon: icon(0), fallbacks, base: palette.signBase, text: palette.signText, brand: palette.brand });
        paintKonbiniPylon(this.pylon.canvas, { font, icon: icon(0), fallbacks, base: palette.signBase, brand: palette.brand });
        paintKonbiniPoster(this.posters[0]!.canvas, {
            font,
            heading: song.artist || title,
            body: song.album || 'NOW ON SALE',
            icon: icon(1),
            fallbacks,
            background: palette.brand[1],
            ink: palette.brand[0],
            accent: palette.brand[2],
            tag: 'NEW',
        });
        paintKonbiniPoster(this.posters[1]!.canvas, {
            font,
            heading: content.theme.name && content.theme.provider === 'AI' ? content.theme.name : (song.album || title),
            body: 'LIMITED',
            icon: icon(2),
            fallbacks,
            background: palette.brand[2],
            ink: '#ffffff',
            accent: palette.brand[0],
            tag: '限定',
        });
        paintKonbiniNeon(this.neon.canvas, icon(0), fallbacks, palette.neon);
        // 屋顶 logo 的图标朝向：默认镜头从前右（方位角 45°）看过来，图标的“上”朝远离镜头的方向。
        paintKonbiniRoofLogo(this.roofLogo.canvas, { corners: this.roofCorners, icon: icon(0), fallbacks, brand: palette.brand, rotation: -Math.PI / 4 });
        const hasThemeName = !!content.theme.name && content.theme.provider === 'AI';
        paintKonbiniAFrame(this.aFrame.canvas, {
            font,
            heading: '本日のテーマ',
            title: hasThemeName ? content.theme.name! : title,
            note: (hasThemeName ? content.theme.description : song.artist) || '',
            icon: icon(1),
            fallbacks,
            chalk: '#eef1ea',
            accent: palette.brand[0],
        });
        this.statics.forEach(sign => { sign.texture.needsUpdate = true; });
        this.screen.setContent({
            palette,
            font,
            measure: createMachiMeasure(font),
            matchers: prepareWordColorMatchers(content.theme.wordColors),
            cardTitle: `♪ ${song.title || 'KONBINI'}`,
            cardSubtitle: song.artist || song.album || '',
        });
        this.led.invalidate();
    }

    /** 换牌面（静态模式、暂停时直接换）。 */
    showBoard(target: MachiBoardTarget, lines: readonly Line[], immediate: boolean, showText = true) {
        this.lines = lines;
        this.boardTarget = target;
        this.screen.show(target, lines, immediate, showText);
        this.led.invalidate();
    }

    /** 空闲时提前画好下一行。 */
    preheat(target: MachiBoardTarget, lines: readonly Line[], showText: boolean) {
        this.screen.preheat(target, lines, showText);
    }

    /** 每帧：屏幕、LED 滚动、招牌亮度（闪烁、副歌、音频）。 */
    update(frame: KonbiniSignFrame) {
        const content = this.content;
        if (!content) return;
        this.screen.update(frame);
        const chorus = this.screen.chorus;

        // LED：内容随牌面换，滚动速度副歌时快一点。
        if (!this.led.hasText && this.boardTarget) {
            this.led.setText(resolveMachiTickerText(this.boardTarget, this.lines, content.song, 'KONBINI'), content.font);
        }
        this.led.update({ delta: frame.delta, staticMode: frame.staticMode, speed: 1 + 0.5 * chorus, audio: frame.audio });

        // 静态招牌：闪烁只落在店招与立柱灯箱上，副歌时不闪、更亮；霓虹随副歌脉动。
        const flicker = chorus > 0.5 ? 1 : frame.flicker;
        const lift = 1 + 0.08 * chorus + 0.05 * frame.audio;
        // 霓虹随拍（智能动感模式）：霓虹招牌是第一组、店招灯箱第三组、立柱灯箱第一组（灯箱只跟一小份），与店招上沿的霓虹边
        // （第二组）轮流慢慢亮起。
        const { beat } = frame;
        this.setLevel(this.fascia, this.fascia.level * lift * machiLightboxGroup(beat, 2));
        this.setLevel(this.pylon, this.pylon.level * flicker * lift * machiLightboxGroup(beat, 0));
        const neonPulse = frame.staticMode ? 1 : 0.85 + 0.15 * Math.sin(frame.ambientTime * 2.2) + 0.4 * chorus;
        this.setLevel(this.neon, this.neon.level * neonPulse * machiNeonGroup(beat, 0));
    }

    private setLevel(sign: { material: THREE.Material }, level: number) {
        if (sign.material instanceof THREE.MeshBasicMaterial) sign.material.color.setScalar(level);
    }

    /** 屏幕上有招牌在动画：暂停时也要继续出帧。 */
    get busy() {
        return this.screen.busy;
    }

    dispose() {
        this.screen.dispose();
        this.led.dispose();
        this.statics.forEach(sign => sign.texture.dispose());
        this.group.traverse(object => {
            if (object instanceof THREE.Mesh && object.material !== this.screen.material && object.material !== this.led.material) object.geometry.dispose();
        });
    }
}
