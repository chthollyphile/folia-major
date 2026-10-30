import * as THREE from 'three';
import { mixHexColors } from '../../../../../utils/themeColorMath';
import type { MachiSongContext } from '../../createMachiRuntime';
import { resolveMachiCar, type MachiLane } from '../../engine/actors/schedules';
import { MachiNobori } from '../../engine/actors/nobori';
import { createBaseClippingPlanes, MachiTraffic } from '../../engine/actors/traffic';
import { machiNeonGroup } from '../../engine/beatFx';
import { resolveMachiFlicker } from '../../engine/director';
import { MachiLightCones } from '../../engine/fx/lightCones';
import { MACHI_REFLECT_LAYER } from '../../engine/fx/reflection';
import { MachiSteam } from '../../engine/fx/steam';
import type { MachiDrip } from '../../engine/fx/weather';
import { bakeStatic, withGeometryCache } from '../../engine/geometry/shapes';
import type { MachiGlowSpec } from '../../engine/materials';
import { seedIndex, type MachiArtResolver } from '../../engine/palette';
import type { MachiScene, MachiSceneContent, MachiSceneContext, MachiSceneDefinition, MachiSceneFrame } from '../types';
import { buildKonbiniBase } from './base';
import { buildKonbiniInterior, type KonbiniProductBatch } from './interior';
import { buildKonbiniDoorEvents, resolveKonbiniDoorOpenness } from './konbiniDoor';
import { KonbiniLights } from './konbiniLights';
import { resolveKonbiniVariation, type KonbiniVariation } from './konbiniSeed';
import { KonbiniSigns } from './konbiniSigns';
import { BASE, BOARD, FASCIA, KONBINI_VIEW, LEVEL, PROPS, ROAD, STORE } from './layout';
import { buildKonbiniProps, buildKonbiniSongProps } from './props';
import { buildKonbiniStore } from './store';

// src/components/visualizer/machi/scenes/konbini/konbiniScene.ts
// 便利店街角（原来的雨町）：两条路在前右角相交，店占后左象限，屋顶三面广告屏逐字点亮当前行，店招 LED 滚下一句，
// 店招写曲名、海报写歌手、门口のぼり旗。会动的：段落开头自动门开合、空调风扇、偶尔开过的车、旗、井盖和外机的白气、
// 路灯光柱。按歌变的：自行车、伞、海报版式、风向、水洼、开门节奏（konbiniSeed.ts）。

/** 便利店自己的颜色：店身、店内、空调外机、反光镜；自行车和伞按 seed 选。 */
const KONBINI_ART = {
    wall: '#cfc9bd',
    trim: '#7f8898',
    roof: '#3a404d',
    frame: '#272c35',
    interiorFloor: '#d6d0c3',
    interiorWall: '#ece6d9',
    shelf: '#c6ccd4',
    counter: '#e6dfcf',
    fridgeBody: '#d3d8de',
    acUnit: '#d4d6d0',
    mirrorPole: '#e5702a',
    spillLight: '#ffcf92',
} as const;
const BIKE_COLORS = ['#c8423a', '#2f6db0', '#e7c64a', '#3f8f5a', '#e9e6dc', '#2a2d34'];
const UMBRELLA_COLORS = ['#e8ecf2', '#2f6db0', '#d24d6e', '#3e4655', '#f0b23e'];

const resolveKonbiniArt: MachiArtResolver = (_theme, seed, base) => ({
    ...KONBINI_ART,
    // 玻璃外溢出的光：店内暖光与固定的琥珀各一半。
    spillLight: mixHexColors(KONBINI_ART.spillLight, base.interiorLight, 0.5),
    bike: BIKE_COLORS[seedIndex(seed, 'bike', BIKE_COLORS.length)]!,
    umbrella: UMBRELLA_COLORS[seedIndex(seed, 'umbrella', UMBRELLA_COLORS.length)]!,
});

/** 自发光件：颜色键与亮度倍数（线性空间，> 1 才会被 bloom 轻轻带出光晕）。 */
const KONBINI_GLOWS: Record<string, MachiGlowSpec> = {
    ceilingLight: { key: 'interiorLight', level: 2.4 },
    fridgeGlow: { key: 'vendingLight', level: 1.5 },
    vendingGlow: { key: 'vendingLight', level: 1.7 },
    lampHead: { key: 'streetLight', level: 3.2 },
    warmWindow: { key: 'interiorLight', level: 0.42 },
    snackCase: { key: 'spillLight', level: 1.6 },
    screen: { key: 'led', level: 1.3 },
    redLamp: { key: 'brand0', level: 1.0 },
    neonRim: { key: 'neon', level: 1.4 },
};

/** 四条车道（靠左行驶）：前路东行 / 西行，右路北行 / 南行。两端伸出底座，车由裁切面从底座边缘“开出来”。 */
const LANE_REACH = 8;
const KONBINI_LANES: readonly MachiLane[] = [
    { from: [-LANE_REACH, ROAD.inner + 0.92], to: [LANE_REACH, ROAD.inner + 0.92] },
    { from: [LANE_REACH, ROAD.outer - 1.12], to: [-LANE_REACH, ROAD.outer - 1.12] },
    { from: [ROAD.inner + 0.92, LANE_REACH], to: [ROAD.inner + 0.92, -LANE_REACH] },
    { from: [ROAD.outer - 1.12, -LANE_REACH], to: [ROAD.outer - 1.12, LANE_REACH] },
];

/** 默认构图要框进去的点：底座顶面四角与两侧厚度、广告塔顶、立柱灯箱顶、店的后角。 */
const framingPoints = () => {
    const h = BASE.half;
    const points: THREE.Vector3[] = [];
    // 底座只框顶面四角加两侧的厚度：离镜头最近的底角压在字幕后面，不必框进来。
    [-h, h].forEach(x => [-h, h].forEach(z => {
        points.push(new THREE.Vector3(x, 0, z));
        if (x !== z || x < 0) points.push(new THREE.Vector3(x, -BASE.depth, z));
    }));
    const boardTop = BOARD.y0 + BOARD.faceHeight + 0.6;
    const r = BOARD.faceWidth / Math.sqrt(3);
    for (let k = 0; k < 3; k += 1) {
        const a = BOARD.azimuth + Math.PI / 3 + (k * 2 * Math.PI) / 3;
        points.push(new THREE.Vector3(BOARD.cx + Math.sin(a) * r, boardTop, BOARD.cz + Math.cos(a) * r));
    }
    points.push(new THREE.Vector3(PROPS.pylon.x, PROPS.pylon.height + 0.3, PROPS.pylon.z));
    points.push(new THREE.Vector3(STORE.x0, STORE.parapetTop, STORE.z0));
    return points;
};

/** 滴水：店招下沿（前面、右面）每隔一段一滴，落水管口一串。 */
const konbiniDrips = (): MachiDrip[] => {
    const drips: MachiDrip[] = [];
    const frontZ = STORE.z1 + FASCIA.depth + 0.07;
    const rightX = STORE.x1 + FASCIA.depth + 0.07;
    for (let x = STORE.x0 + 0.3; x < STORE.x1; x += 0.42) {
        drips.push({ x: x + (Math.random() - 0.5) * 0.12, z: frontZ, from: FASCIA.y0 - 0.02, to: LEVEL.lot, period: 1.1 + Math.random() * 1.8, phase: Math.random() });
    }
    for (let z = STORE.z1; z > STORE.z0 + 0.5; z -= 0.45) {
        drips.push({ x: rightX, z: z + (Math.random() - 0.5) * 0.12, from: FASCIA.y0 - 0.02, to: LEVEL.lot, period: 1.1 + Math.random() * 1.8, phase: Math.random() });
    }
    for (let index = 0; index < 4; index += 1) {
        drips.push({ x: STORE.x0 - 0.12 + (Math.random() - 0.5) * 0.04, z: STORE.z1 + 0.06, from: LEVEL.lot + 0.08, to: LEVEL.lot, period: 0.32 + Math.random() * 0.12, phase: index / 4 });
    }
    return drips;
};

/** object 是不是 ancestor 的后代。 */
const isInside = (object: THREE.Object3D, ancestor: THREE.Object3D) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === ancestor) return true;
    return false;
};

class KonbiniScene implements MachiScene {
    readonly root = new THREE.Group();
    readonly framing;
    readonly weather;
    readonly reflectionPlaneY = 0.06;
    readonly surfaces;
    readonly puddles;
    // 三面塔正对默认镜头那一面的中心：对焦对着字，不是塔心（大光圈下清晰的那一层只有一米来厚，塔心离字面一米六）。
    readonly focusPoint = new THREE.Vector3(
        BOARD.cx + Math.sin(BOARD.azimuth) * BOARD.faceWidth / (2 * Math.sqrt(3)),
        BOARD.y0 + BOARD.faceHeight / 2,
        BOARD.cz + Math.cos(BOARD.azimuth) * BOARD.faceWidth / (2 * Math.sqrt(3)),
    );
    private readonly world = new THREE.Group();
    private songProps: THREE.Group;
    private readonly productBatches: KonbiniProductBatch[];
    private readonly doorPanels: ReturnType<typeof buildKonbiniStore>['doorPanels'];
    private readonly fans: THREE.Object3D[];
    private readonly lights: KonbiniLights;
    private readonly signs: KonbiniSigns;
    private readonly traffic: MachiTraffic;
    private readonly nobori: MachiNobori;
    private readonly lightCones: MachiLightCones;
    private readonly steam: MachiSteam;
    private readonly glowA: THREE.Vector4;
    private readonly glowB: THREE.Vector4;
    private variation: KonbiniVariation;
    private song: MachiSongContext;
    private doorEvents: number[];
    private doorOpenness = 0;

    constructor(private readonly context: MachiSceneContext) {
        const { materials, blend, geometryCache } = context;
        this.song = context.song;
        const variation = resolveKonbiniVariation(context.song.seed);
        this.variation = variation;
        this.doorEvents = buildKonbiniDoorEvents(context.song.lines, variation);
        materials.defineGlows(KONBINI_GLOWS);
        this.root.name = 'Konbini';

        const { base, interior, store, props, songProps } = withGeometryCache(geometryCache, () => {
            const builtInterior = buildKonbiniInterior(materials, variation.shelfSeed);
            return {
                base: buildKonbiniBase(materials),
                interior: builtInterior,
                store: buildKonbiniStore(materials, builtInterior.group),
                props: buildKonbiniProps(materials),
                songProps: buildKonbiniSongProps(materials, variation),
            };
        });
        this.productBatches = [...interior.productBatches, ...props.productBatches];
        this.doorPanels = store.doorPanels;
        this.fans = props.fans;
        this.world.name = 'Konbini/world';
        this.world.add(base.group, store.group, props.group, songProps);
        // 亮的东西进倒影图层（合批前打上，合批按图层分开）。店本身也进：倒影镜头不认灯光，卡通材质在那里是全黑的，
        // 正好当遮挡，屋顶上的广告塔不会穿过店身映到店前的水洼里。
        this.world.traverse(object => {
            if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
            const isGlow = object.material.name.startsWith('machi:glow');
            const isStoreBody = !object.material.transparent && object.parent !== null && isInside(object, store.group);
            if (isGlow || isStoreBody) object.layers.enable(MACHI_REFLECT_LAYER);
        });
        this.surfaces = { road: [base.roadSurface], lot: base.lotSurfaces };
        this.puddles = { offset: variation.puddleOffset, amount: variation.puddleAmount };
        bakeStatic(this.world);
        this.songProps = songProps;

        this.lights = new KonbiniLights(blend, materials, props.streetLampHead);
        this.signs = new KonbiniSigns(materials, blend, {
            boardFaces: store.boardFaces,
            fasciaFaces: store.fasciaFaces,
            pylonFaces: props.pylonFaces,
            aFrameFaces: props.aFrameFaces,
            boardLid: store.boardLid,
        });
        this.signs.group.traverse(object => {
            if (object instanceof THREE.Mesh && !object.name.startsWith('Poster') && !object.name.startsWith('AFrame') && object.name !== 'Board/roofLogo') object.layers.enable(MACHI_REFLECT_LAYER);
        });

        const clipping = createBaseClippingPlanes(BASE.half);
        this.traffic = withGeometryCache(geometryCache, () => new MachiTraffic(materials, blend, clipping, KONBINI_LANES, LEVEL.road));
        // 门口三面旗：门左边的场地边上，避开自行车；布面朝前右（大致对着默认镜头），旗杆在左。
        this.nobori = new MachiNobori(materials, [-3.25, -2.5, -1.78].map(x => ({ x, y: LEVEL.lot, z: 1.9, rotationY: 0.35 })));
        const lamp = props.streetLampHead;
        this.lightCones = new MachiLightCones(materials, blend, [
            { apex: lamp, target: new THREE.Vector3(lamp.x - 0.2, LEVEL.road, lamp.z), radius: 1.65, gain: 1 },
        ]);
        this.steam = new MachiSteam(materials, blend, [
            { position: new THREE.Vector3(-2.4, LEVEL.road + 0.02, (ROAD.inner + ROAD.outer) / 2 + 0.3), puffs: 7, period: 4.4, size: 1 },
            { position: new THREE.Vector3(PROPS.roofAc[0].x - 0.12, STORE.roofTop + 0.68, PROPS.roofAc[0].z + 0.2), puffs: 5, period: 3.3, size: 0.6 },
        ]);
        this.root.add(this.world, this.lights.group, this.signs.group, this.traffic.group, this.nobori.group, this.lightCones.mesh, this.steam.mesh);

        const boardFront = new THREE.Vector3(Math.sin(BOARD.azimuth), 0, Math.cos(BOARD.azimuth)).multiplyScalar(BOARD.faceWidth / (2 * Math.sqrt(3)) + 0.8);
        this.weather = {
            half: BASE.half,
            groundY: LEVEL.lot * 0.5,
            roofs: [{ x0: STORE.x0 - STORE.overhang, z0: STORE.z0 - STORE.overhang, x1: STORE.x1 + STORE.overhang, z1: STORE.z1 + STORE.overhang, y: STORE.roofTop }],
            drips: konbiniDrips(),
            // 落进灯光里的雨丝被照亮：路灯光柱、店门口、广告屏前。
            glints: [
                { position: new THREE.Vector3(lamp.x - 0.2, 2.4, lamp.z), radius: 1.7 },
                { position: new THREE.Vector3((STORE.frontPillarEnd + STORE.x1) / 2, 1.5, STORE.z1 + 0.9), radius: 2.0 },
                { position: new THREE.Vector3(BOARD.cx + boardFront.x, BOARD.y0 + BOARD.faceHeight * 0.55, BOARD.cz + boardFront.z), radius: 2.1 },
            ],
            windYaw: variation.windYaw,
            windSlant: variation.windSlant,
        };
        this.framing = { points: framingPoints(), view: { ...KONBINI_VIEW } };
        // 雾里的两处灯：店门口、路灯下。
        this.glowA = new THREE.Vector4((STORE.frontPillarEnd + STORE.x1) / 2 + 0.6, 0, STORE.z1 + 0.9, 3.4);
        this.glowB = new THREE.Vector4(lamp.x, 0, lamp.z, 2.3);
        this.syncColors();
        context.invalidateShadows();
    }

    setContent(content: MachiSceneContent) {
        this.signs.setContent(content);
        const icons = content.icons;
        const { palette } = content;
        this.nobori.paint({
            font: content.font,
            fallbacks: content.fallbacks,
            faces: [
                { background: palette.brand[0], ink: '#ffffff', text: content.song.title || content.song.album || '町景' },
                { background: palette.brand[2], ink: '#ffffff', text: (content.theme.provider === 'AI' ? content.theme.name : '') || '新発売', icon: icons[0] },
                { background: palette.brand[1], ink: palette.signText, text: 'おでん' },
            ],
        });
    }

    swapSong(song: MachiSongContext, content: MachiSceneContent) {
        const seedChanged = song.seed !== this.song.seed;
        this.song = song;
        this.variation = resolveKonbiniVariation(song.seed);
        if (seedChanged) this.rebuildSongProps();
        this.doorEvents = buildKonbiniDoorEvents(song.lines, this.variation);
        this.setContent(content);
    }

    /** 换歌：按新 seed 重建自行车和伞（只有这一组跟着歌变几何）。 */
    private rebuildSongProps() {
        const shared = new Set(this.context.geometryCache.values());
        this.songProps.removeFromParent();
        this.songProps.traverse(object => {
            if (object instanceof THREE.Mesh && !shared.has(object.geometry)) object.geometry.dispose();
        });
        const holder = new THREE.Group();
        const next = withGeometryCache(this.context.geometryCache, () => buildKonbiniSongProps(this.context.materials, this.variation));
        holder.add(next);
        bakeStatic(holder);
        next.removeFromParent();
        this.world.add(next);
        this.songProps = next;
        this.context.invalidateShadows();
    }

    direct(frame: MachiSceneFrame) {
        const { songTime, ambientTime, chorus, staticMode } = frame;
        if (frame.targetChanged) this.signs.showBoard(frame.target, frame.lines, frame.immediate, frame.showText);
        else if (frame.preheat) this.signs.preheat(frame.preheat, frame.lines, frame.showText);
        const { environment, look } = frame;
        const streetFlicker = staticMode ? 1 : resolveMachiFlicker(ambientTime + 3.1, `${frame.seed}:street`, 0.45);
        // 白天店里的灯弱下去，路灯熄掉；光柱、地上的光斑、雾里的灯跟着。
        const street = look.streetLamps * (0.75 + 0.25 * streetFlicker);
        const openness = resolveKonbiniDoorOpenness(this.doorEvents, songTime, this.variation, this.song.isInstrumental || frame.lines.length === 0);
        if (Math.abs(openness - this.doorOpenness) > 1e-4) {
            this.doorOpenness = openness;
            this.context.invalidateShadows();
        }
        // 霓虹随拍（智能动感模式）：店里的灯（连同它投在地上的光斑）跟着小节慢慢涨落，店招上沿的霓虹边是第二组霓虹；
        // 地面干时光斑跟鼓点跳。
        const { beat } = frame;
        const interiorLevel = (1 + 0.1 * chorus + 0.06 * this.doorOpenness) * look.artificial * beat.warm;
        this.lights.setLevels({ interior: interiorLevel, street, pools: (1 - 0.85 * environment.daylight) * (1 + beat.thump) });
        this.context.materials.setGlowLevel('neonRim', (0.75 + 0.25 * frame.flicker) * (1 + 0.4 * chorus) * look.artificial * machiNeonGroup(beat, 1));
        this.context.materials.setGlowLevel('lampHead', 0.15 + 0.85 * look.streetLamps);
        // 会动的东西：车按氛围时钟，旗随风飘，白气、光柱慢慢流。静态模式下街上没有车，场景是一张定格的画。
        this.traffic.group.visible = !staticMode;
        this.traffic.update(ambientTime, frame.seed, frame.trafficChance);
        this.nobori.update(ambientTime, 0.35 + 0.65 * Math.min(1, frame.rain));
        this.lightCones.update(ambientTime, street * (1 - 0.6 * environment.daylight));
        this.steam.update(ambientTime, frame.atmosphere.wind);
        const atmosphere = frame.atmosphere;
        atmosphere.glowA.copy(this.glowA);
        atmosphere.glowB.copy(this.glowB);
        const night = 1 - 0.85 * environment.daylight;
        atmosphere.glowColorA.copy(this.context.blend.get('interiorLight')).multiplyScalar(0.55 * interiorLevel * night);
        atmosphere.glowColorB.copy(this.context.blend.get('streetLight')).multiplyScalar(0.42 * street * night);
        this.signs.update({
            songTime,
            ambientTime,
            delta: frame.delta,
            staticMode,
            chorus,
            audio: frame.audio,
            flicker: frame.flicker,
            beat,
        });
        // 风扇转、自动门滑开。
        this.fans.forEach((fan, index) => {
            fan.rotation.z = -ambientTime * (this.variation.fanSpeed + index * 0.37) * Math.PI * 2;
        });
        this.doorPanels.forEach(panel => {
            panel.object.position.x = panel.closedX + panel.direction * 0.86 * this.doorOpenness;
        });
    }

    syncColors() {
        this.context.materials.syncColors();
        this.lights.sync();
        this.traffic.syncColors();
        this.lightCones.syncColors();
        this.steam.syncColors();
        const color = new THREE.Color();
        this.productBatches.forEach(batch => {
            for (let index = 0; index < batch.colorIndex.length; index += 1) {
                color.copy(this.context.blend.get(`product${batch.colorIndex[index]!}`)).multiplyScalar(batch.shade[index]!);
                batch.mesh.setColorAt(index, color);
            }
            if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
        });
    }

    get busy() {
        return this.signs.busy;
    }

    nextCar(from: number, seed: string | number, chance: number) {
        for (let t = from; t < from + 120; t += 0.04) {
            const car = resolveMachiCar(t, seed, KONBINI_LANES, chance);
            if (car && Math.abs(car.distance - LANE_REACH) < 0.3) return t;
        }
        return null;
    }

    dispose() {
        const geometries = new Set<THREE.BufferGeometry>(this.context.geometryCache.values());
        this.root.traverse(object => {
            if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) geometries.add(object.geometry);
        });
        geometries.forEach(geometry => geometry.dispose());
        this.lights.dispose();
        this.signs.dispose();
        this.traffic.dispose();
        this.nobori.dispose();
        this.lightCones.dispose();
        this.steam.dispose();
        this.context.materials.dispose();
        this.root.removeFromParent();
    }
}

export const KONBINI_SCENE: MachiSceneDefinition = {
    resolveArt: resolveKonbiniArt,
    create: context => new KonbiniScene(context),
};
