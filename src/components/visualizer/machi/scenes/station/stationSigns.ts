import * as THREE from 'three';
import type { Line } from '../../../../../types';
import { prepareWordColorMatchers } from '../../../wordColoring';
import { machiLightboxGroup, machiNeonGroup, type MachiBeatFrame } from '../../engine/beatFx';
import { resolveMachiTickerText, type MachiBoardTarget } from '../../engine/director';
import { MachiLedStrip } from '../../engine/ledStrip';
import { MachiLyricScreen } from '../../engine/lyricScreen';
import type { MachiColorBlend, MachiMaterials } from '../../engine/materials';
import { createCanvas, createMachiMeasure, type MachiFont } from '../../engine/signRaster';
import type { MachiSceneContent } from '../types';
import type { StationPlacement } from './structures';
import {
    paintMotelName,
    paintMotelTall,
    paintMotelVacancy,
    paintStationCanopy,
    paintStationPylon,
} from './stationSignPaint';

// src/components/visualizer/machi/scenes/station/stationSigns.ts
// 加油站停车场的招牌：アドトラック货厢侧面的 LED 屏（engine/lyricScreen.ts，当前行逐字点亮）、出租车顶灯
// （engine/ledStrip.ts：一辆滚下一句 / 译文，一辆滚曲名与歌手）、罩棚店招（歌手当站名）、价格立柱（七段数码管：
// 播放进度、总时长、第几句，每秒重画一次）、汽车旅馆立牌（霓虹 MOTEL、写曲名的横牌、VACANCY——副歌时 NO 亮起来，
// 箭头上一圈走马灯泡）。颜色、图标、字体都从主题来。

export interface StationSignPlacements {
    screen: StationPlacement;
    andons: (StationPlacement & { role: 'ticker' | 'credits' })[];
    canopy: StationPlacement[];
    pylon: StationPlacement[];
    motel: { tall: StationPlacement; name: StationPlacement; vacancy: StationPlacement; bulbs: THREE.Vector3[] };
}

export interface StationSignFrame {
    songTime: number;
    ambientTime: number;
    delta: number;
    staticMode: boolean;
    chorus: number;
    audio: number;
    flicker: number;
    /** 人造光的亮度（白天弱）。 */
    artificial: number;
    lineIndex: number;
    beat: MachiBeatFrame;
}

const BULB_VERTEX = /* glsl */ `
attribute float aIndex;
uniform float uTime;
uniform float uCount;
varying float vOn;
void main() {
    // 走马灯：每四个灯泡一组，亮的那一位沿着箭头往前走。
    float phase = fract((aIndex - uTime * 6.0) / 4.0);
    vOn = step(0.5, phase);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const BULB_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying float vOn;
void main() {
    gl_FragColor = vec4(uColor * mix(0.18, 1.9, vOn) * uLevel, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const canvasTexture = (canvas: HTMLCanvasElement, anisotropy = 4) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
};

const placedPlane = (material: THREE.Material, placement: StationPlacement, name: string) => {
    const result = new THREE.Mesh(new THREE.PlaneGeometry(placement.width, placement.height), material);
    result.name = name;
    result.position.copy(placement.position);
    result.rotation.y = placement.rotationY;
    return result;
};

const formatClock = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.min(99, Math.floor(total / 60));
    return `${String(minutes).padStart(2, ' ')}:${String(total % 60).padStart(2, '0')}`;
};

interface StaticSign {
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    material: THREE.MeshBasicMaterial;
    level: number;
}

export class StationSigns {
    readonly group = new THREE.Group();
    private readonly screen: MachiLyricScreen;
    private readonly tickers: { strip: MachiLedStrip; role: 'ticker' | 'credits' }[];
    private readonly statics: StaticSign[] = [];
    private readonly canopy: StaticSign;
    private readonly pylon: StaticSign;
    private readonly motelTall: StaticSign;
    private readonly motelName: StaticSign;
    private readonly vacancy: StaticSign;
    private readonly vacancyFull: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture };
    private readonly bulbMaterial: THREE.ShaderMaterial;
    private readonly geometries: THREE.BufferGeometry[] = [];
    private content: MachiSceneContent | null = null;
    private boardTarget: MachiBoardTarget | null = null;
    private lines: readonly Line[] = [];
    private pylonKey = '';
    private full = false;

    constructor(materials: MachiMaterials, private readonly blend: MachiColorBlend, placements: StationSignPlacements) {
        this.group.name = 'Signs';
        this.screen = new MachiLyricScreen(materials, blend, placements.screen.width, placements.screen.height);
        this.group.add(this.screen.createFace(placements.screen.position, placements.screen.rotationY, 'Truck/screen'));
        this.tickers = placements.andons.map((andon, index) => {
            const strip = new MachiLedStrip(materials, blend, andon.width, andon.height, 10);
            this.group.add(strip.createFace(andon.position, andon.rotationY, `Taxi${index}/andon`));
            return { strip, role: andon.role };
        });

        this.canopy = this.staticSign(materials, 1024, Math.round(1024 * placements.canopy[0]!.height / placements.canopy[0]!.width), 0.82);
        placements.canopy.forEach((face, index) => this.group.add(placedPlane(this.canopy.material, face, `Canopy/sign${index}`)));
        const pylonFace = placements.pylon[0]!;
        this.pylon = this.staticSign(materials, 360, Math.round(360 * pylonFace.height / pylonFace.width), 0.92);
        placements.pylon.forEach((face, index) => this.group.add(placedPlane(this.pylon.material, face, `Pylon/face${index}`)));

        const { tall, name, vacancy } = placements.motel;
        this.motelTall = this.staticSign(materials, 256, Math.round(256 * tall.height / tall.width), 1.15);
        this.group.add(placedPlane(this.motelTall.material, tall, 'Motel/tall'));
        this.motelName = this.staticSign(materials, 640, Math.round(640 * name.height / name.width), 1.1);
        this.group.add(placedPlane(this.motelName.material, name, 'Motel/name'));
        this.vacancy = this.staticSign(materials, 384, Math.round(384 * vacancy.height / vacancy.width), 1.1);
        this.group.add(placedPlane(this.vacancy.material, vacancy, 'Motel/vacancy'));
        const fullCanvas = createCanvas(this.vacancy.canvas.width, this.vacancy.canvas.height);
        this.vacancyFull = { canvas: fullCanvas, texture: canvasTexture(fullCanvas) };

        // 箭头上的走马灯泡：一个 InstancedMesh，亮哪一个在着色器里按时间算。
        const bulbGeometry = new THREE.SphereGeometry(0.04, 8, 6);
        this.geometries.push(bulbGeometry);
        const bulbs = placements.motel.bulbs;
        const indices = new Float32Array(bulbs.length).map((_, index) => index);
        bulbGeometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(indices, 1));
        this.bulbMaterial = materials.track(new THREE.ShaderMaterial({
            vertexShader: BULB_VERTEX,
            fragmentShader: BULB_FRAGMENT,
            uniforms: { uTime: { value: 0 }, uCount: { value: bulbs.length }, uColor: { value: new THREE.Color(1, 0.82, 0.48) }, uLevel: { value: 1 } },
        }));
        const bulbMesh = new THREE.InstancedMesh(bulbGeometry, this.bulbMaterial, bulbs.length);
        bulbMesh.name = 'Motel/bulbs';
        const matrix = new THREE.Matrix4();
        bulbs.forEach((bulb, index) => {
            matrix.makeTranslation(bulb.x, bulb.y, bulb.z);
            bulbMesh.setMatrixAt(index, matrix);
        });
        bulbMesh.castShadow = false;
        this.group.add(bulbMesh);
    }

    private staticSign(materials: MachiMaterials, width: number, height: number, level: number): StaticSign {
        const canvas = createCanvas(width, height);
        const texture = canvasTexture(canvas);
        const material = materials.track(new THREE.MeshBasicMaterial({ map: texture }));
        material.color.setScalar(level);
        const sign = { canvas, texture, material, level };
        this.statics.push(sign);
        return sign;
    }

    private get font(): MachiFont {
        return this.content!.font;
    }

    /** 换歌 / 换主题：重画所有招牌。 */
    setContent(content: MachiSceneContent) {
        this.content = content;
        const { palette, font, song, fallbacks } = content;
        const icon = (index: number) => content.icons.length ? content.icons[index % content.icons.length] : fallbacks[index % fallbacks.length];
        const title = song.title || song.album || 'MACHI';
        paintStationCanopy(this.canopy.canvas, {
            font,
            name: (song.artist || song.album || title).toUpperCase(),
            icon: icon(0),
            fallbacks,
            base: palette.signBase,
            text: palette.signText,
            brand: palette.brand,
        });
        paintMotelTall(this.motelTall.canvas, font, palette.neon);
        paintMotelName(this.motelName.canvas, font, title, palette.brand[2]);
        paintMotelVacancy(this.vacancy.canvas, font, false);
        paintMotelVacancy(this.vacancyFull.canvas, font, true);
        this.vacancyFull.texture.needsUpdate = true;
        this.statics.forEach(sign => { sign.texture.needsUpdate = true; });
        this.pylonKey = '';
        this.screen.setContent({
            palette,
            font,
            measure: createMachiMeasure(font),
            matchers: prepareWordColorMatchers(content.theme.wordColors),
            cardTitle: `♪ ${song.title || 'MACHI'}`,
            cardSubtitle: song.artist || song.album || '',
        });
        this.tickers.forEach(ticker => ticker.strip.invalidate());
    }

    showBoard(target: MachiBoardTarget, lines: readonly Line[], immediate: boolean, showText = true) {
        this.lines = lines;
        this.boardTarget = target;
        this.screen.show(target, lines, immediate, showText);
        this.tickers.forEach(ticker => { if (ticker.role === 'ticker') ticker.strip.invalidate(); });
    }

    preheat(target: MachiBoardTarget, lines: readonly Line[], showText: boolean) {
        this.screen.preheat(target, lines, showText);
    }

    /** 价格立柱的三行：播放进度、总时长、第几句（变了才重画）。 */
    private paintPylon(songTime: number, lineIndex: number) {
        const content = this.content!;
        const lines = content.song.lines;
        const total = lines.length ? lines[lines.length - 1]!.endTime : 0;
        const rows = [
            { label: 'レギュラー', value: formatClock(songTime) },
            { label: 'ハイオク', value: formatClock(total) },
            { label: '軽油', value: lineIndex >= 0 ? String(lineIndex + 1).padStart(3, ' ') : '---' },
        ];
        const key = rows.map(row => row.value).join('|');
        if (key === this.pylonKey) return;
        this.pylonKey = key;
        const icons = content.icons;
        paintStationPylon(this.pylon.canvas, {
            font: this.font,
            icon: icons.length ? icons[0] : content.fallbacks[0],
            fallbacks: content.fallbacks,
            brand: content.palette.brand,
            rows,
            digit: '#ff5a3c',
        });
        this.pylon.texture.needsUpdate = true;
    }

    update(frame: StationSignFrame) {
        const content = this.content;
        if (!content) return;
        this.screen.update(frame);
        const chorus = this.screen.chorus;
        this.tickers.forEach(ticker => {
            if (!ticker.strip.hasText && this.boardTarget) {
                const text = ticker.role === 'ticker'
                    ? resolveMachiTickerText(this.boardTarget, this.lines, content.song, 'MACHI')
                    : `♪ ${content.song.title || 'MACHI'}${content.song.artist ? ` — ${content.song.artist}` : ''}   ◆   空車   ◆   `;
                ticker.strip.setText(text, content.font);
            }
            ticker.strip.update({ delta: frame.delta, staticMode: frame.staticMode, speed: 0.8 + 0.4 * chorus, audio: frame.audio });
        });
        this.paintPylon(frame.songTime, frame.lineIndex);
        // 客满：副歌时 VACANCY 前面的 NO 亮起来。
        const full = chorus > 0.5;
        if (full !== this.full) {
            this.full = full;
            this.vacancy.material.map = full ? this.vacancyFull.texture : this.vacancy.texture;
            this.vacancy.material.needsUpdate = true;
        }
        // 霓虹随拍（智能动感模式）：旅馆的竖招牌、店名、空房灯分在三组轮流慢慢亮起；罩棚店招（第二组）与价格立柱（第三组）
        // 的灯箱只跟一小份。
        const { beat } = frame;
        const neon = (0.8 + 0.2 * frame.flicker) * (1 + 0.15 * chorus) * machiNeonGroup(beat, 0);
        this.motelTall.material.color.setScalar(this.motelTall.level * neon * frame.artificial);
        this.motelName.material.color.setScalar(this.motelName.level * frame.artificial * machiNeonGroup(beat, 1));
        this.vacancy.material.color.setScalar(this.vacancy.level * frame.artificial * machiNeonGroup(beat, 2));
        this.canopy.material.color.setScalar(this.canopy.level * (0.7 + 0.3 * frame.artificial) * machiLightboxGroup(beat, 1));
        this.pylon.material.color.setScalar(this.pylon.level * (0.75 + 0.25 * frame.artificial) * machiLightboxGroup(beat, 2));
        this.bulbMaterial.uniforms.uTime!.value = frame.staticMode ? 0 : frame.ambientTime;
        this.bulbMaterial.uniforms.uLevel!.value = frame.artificial;
        (this.bulbMaterial.uniforms.uColor!.value as THREE.Color).copy(this.blend.get('streetLight'));
    }

    get busy() {
        return this.screen.busy;
    }

    dispose() {
        this.screen.dispose();
        this.tickers.forEach(ticker => ticker.strip.dispose());
        this.statics.forEach(sign => sign.texture.dispose());
        this.vacancyFull.texture.dispose();
        this.geometries.forEach(geometry => geometry.dispose());
        this.group.traverse(object => {
            if (object instanceof THREE.Mesh && object.name.match(/^(Canopy|Pylon|Motel)\//)) object.geometry.dispose();
        });
    }
}
