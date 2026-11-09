import * as THREE from 'three';
import { hashVisualizerSeed, visualizerHash01 } from '../../../visualizerSeedHash';
import type { MachiSongContext } from '../../createMachiRuntime';
import { MachiNobori } from '../../engine/actors/nobori';
import { resolveMachiCar, type MachiLane } from '../../engine/actors/schedules';
import { createBaseClippingPlanes, createSoftEllipseTexture, MachiTraffic } from '../../engine/actors/traffic';
import { machiNeonGroup } from '../../engine/beatFx';
import { resolveMachiFlicker } from '../../engine/director';
import { MachiLightCones } from '../../engine/fx/lightCones';
import { MACHI_REFLECT_LAYER } from '../../engine/fx/reflection';
import { MachiSteam } from '../../engine/fx/steam';
import type { MachiDrip } from '../../engine/fx/weather';
import { MACHI_BASE } from '../../engine/geometry/plinth';
import { bakeStatic, group, withGeometryCache } from '../../engine/geometry/shapes';
import type { MachiGlowSpec } from '../../engine/materials';
import { seedIndex, vivid, type MachiArtResolver } from '../../engine/palette';
import type { MachiScene, MachiSceneContent, MachiSceneContext, MachiSceneDefinition, MachiSceneFrame } from '../types';
import { CANOPY, KEI_TRUCK, LEVEL, PUMP_CAR, ROAD, STALLS, STATION_VIEW, TRUCK, TRUCK_SCREEN } from './layout';
import { StationLights } from './stationLights';
import { resolveStationVariation, type StationVariation } from './stationSeed';
import { StationSigns } from './stationSigns';
import {
    buildCanopy,
    buildIslands,
    buildLotLamp,
    buildMotelSign,
    buildPylon,
    buildStationGround,
    buildStationProps,
    stationFramingPoints,
} from './structures';
import { buildAdTruck, buildParkedCar } from './vehicles';

// src/components/visualizer/machi/scenes/station/stationScene.ts
// 加油站停车场：前面一条路，后排左边停着一辆アドトラック（货厢侧面的 LED 屏逐字点亮当前行），后排右边是加油站罩棚，
// 前排车位停着出租车（顶灯滚下一句、曲名与歌手）和私家车，路边一根价格立柱（播放进度），左前角一根汽车旅馆的高立牌
// （名字是曲名，副歌时 NO VACANCY）。会动的：路过的车、走马灯泡、出租车顶灯、价格数字、偶尔打双闪的车、货车排气、
// 加油站的のぼり旗。按歌变的：车位停什么、车色、出租车配色、风向、水洼（stationSeed.ts）。

/** 车身颜色（白、银、黑、藏青、红、深绿、米色）。 */
const CAR_COLORS = ['#e8eaee', '#aeb5bf', '#25292f', '#22385f', '#b8322e', '#2f5a48', '#d8cdb4'];
/** 出租车配色：车身与腰线 / 顶灯色。 */
const TAXI_LIVERIES: [string, string][] = [
    ['#f1c232', '#2b2f36'],
    ['#2a2d33', '#e8a23a'],
    ['#e9ecef', '#2f8a4f'],
    ['#2f6fb0', '#f1f1ec'],
];

const STATION_ART = {
    canopyFascia: '#f3f1eb',
    canopyTop: '#aeb4bc',
    canopyUnder: '#d4d7dd',
    canopyColumn: '#e5e3dd',
    canopyLight: '#eef4ff',
    pumpBody: '#ecebe6',
    truckBox: '#e9ecef',
    carGlass: '#1b2230',
    motelBack: '#1b333d',
    motelPole: '#bdb6a8',
    marker: '#ffae42',
} as const;

const resolveStationArt: MachiArtResolver = (_theme, seed, base) => {
    const variation = resolveStationVariation(seed, CAR_COLORS.length, TAXI_LIVERIES.length);
    const livery = TAXI_LIVERIES[variation.taxiLivery]!;
    return {
        ...STATION_ART,
        // 货车的车头用主题的副色，像一家运输公司的涂装。
        truckCab: vivid(base.brand[2], 0.5, 0.38, 0.5),
        taxiBody: livery[0],
        taxiTrim: livery[1],
        car0: CAR_COLORS[variation.carColors[0]!]!,
        car1: CAR_COLORS[variation.carColors[1]!]!,
        car2: CAR_COLORS[variation.carColors[2]!]!,
        carPump: CAR_COLORS[variation.pumpColor]!,
        carKei: CAR_COLORS[(variation.keiColor + seedIndex(seed, 'kei', 2)) % CAR_COLORS.length]!,
    };
};

const STATION_GLOWS: Record<string, MachiGlowSpec> = {
    canopyLight: { key: 'canopyLight', level: 2.4 },
    pumpScreen: { key: 'led', level: 1.1 },
    marker: { key: 'marker', level: 1.8 },
    carHead: { key: 'streetLight', level: 2.2 },
    carTail: { key: 'stopRed', level: 1.6 },
    hazard: { key: 'marker', level: 2.4 },
    hazardIdle: { key: 'marker', level: 0.12 },
    vacant: { key: 'stopRed', level: 1.8 },
    lampHead: { key: 'streetLight', level: 3.2 },
    motelNeon: { key: 'neon', level: 1.6 },
};

/** 两条车道（靠左行驶）：近的往 +x，远的往 -x。两端伸出底座，车由裁切面从底座边缘“开出来”。 */
const LANE_REACH = 8;
const STATION_LANES: readonly MachiLane[] = [
    { from: [-LANE_REACH, ROAD.lanes[0]], to: [LANE_REACH, ROAD.lanes[0]] },
    { from: [LANE_REACH, ROAD.lanes[1]], to: [-LANE_REACH, ROAD.lanes[1]] },
];

/** 双闪：每 18 秒一个窗口，按哈希决定这个窗口里那辆车打不打双闪（打的话闪 6 秒）。 */
const hazardOn = (time: number, seed: string | number) => {
    const window = 18;
    const index = Math.floor(time / window);
    const key = hashVisualizerSeed(`hazard:${seed}`);
    if (visualizerHash01(key, index, 0x21) > 0.5) return false;
    const local = time - index * window - visualizerHash01(key, index, 0x42) * 10;
    if (local < 0 || local > 6) return false;
    return Math.floor(local * 2.8) % 2 === 0;
};

/** 罩棚前沿、右沿的滴水。 */
const stationDrips = (): MachiDrip[] => {
    const drips: MachiDrip[] = [];
    for (let x = CANOPY.x0 + 0.2; x < CANOPY.x1; x += 0.45) {
        drips.push({ x: x + (Math.random() - 0.5) * 0.1, z: CANOPY.z1 + 0.06, from: CANOPY.under - 0.02, to: LEVEL.apron, period: 1.0 + Math.random() * 1.6, phase: Math.random() });
    }
    for (let z = CANOPY.z1; z > CANOPY.z0 + 0.3; z -= 0.5) {
        drips.push({ x: CANOPY.x1 + 0.06, z: z + (Math.random() - 0.5) * 0.1, from: CANOPY.under - 0.02, to: LEVEL.apron, period: 1.0 + Math.random() * 1.6, phase: Math.random() });
    }
    return drips;
};

class StationScene implements MachiScene {
    readonly root = new THREE.Group();
    readonly framing;
    readonly weather;
    readonly reflectionPlaneY = 0.04;
    readonly rebuildsForSeed = true;
    readonly surfaces;
    readonly puddles;
    readonly focusPoint = new THREE.Vector3(TRUCK_SCREEN.x, TRUCK_SCREEN.y, TRUCK_SCREEN.z);
    private readonly world = new THREE.Group();
    private readonly lights: StationLights;
    private readonly signs: StationSigns;
    private readonly traffic: MachiTraffic;
    private readonly nobori: MachiNobori;
    private readonly lightCones: MachiLightCones;
    private readonly steam: MachiSteam;
    private readonly textures: THREE.Texture[] = [];
    private readonly glowA: THREE.Vector4;
    private readonly glowB: THREE.Vector4;
    private readonly variation: StationVariation;

    constructor(private readonly context: MachiSceneContext) {
        const { materials, blend, geometryCache } = context;
        const variation = resolveStationVariation(context.song.seed, CAR_COLORS.length, TAXI_LIVERIES.length);
        this.variation = variation;
        materials.defineGlows(STATION_GLOWS);
        this.root.name = 'Station';

        const shadowTexture = createSoftEllipseTexture();
        this.textures.push(shadowTexture);
        const shadow = materials.track(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture, transparent: true, opacity: 0.5, depthWrite: false }));

        const built = withGeometryCache(geometryCache, () => {
            const ground = buildStationGround(materials);
            const canopy = buildCanopy(materials);
            const pylon = buildPylon(materials);
            const motel = buildMotelSign(materials);
            const lamp = buildLotLamp(materials);
            const truck = buildAdTruck(materials, shadow);
            // 前排车位：出租车车头朝 +z（顶灯朝镜头），轿车也一样停。
            const andons: { position: THREE.Vector3; rotationY: number; width: number; height: number; role: 'ticker' | 'credits' }[] = [];
            const cars: THREE.Object3D[] = [];
            variation.stalls.forEach((kind, index) => {
                if (kind === 'empty') return;
                const car = buildParkedCar(materials, kind, kind === 'taxi' ? 'taxiBody' : `car${index}`, `Stall${index}`, shadow, index === variation.hazardStall);
                car.group.position.set(STALLS.x[index]!, LEVEL.road, STALLS.z + 0.15);
                cars.push(car.group);
                if (car.andon) {
                    andons.push({
                        position: car.andon.position.clone().add(car.group.position),
                        rotationY: 0,
                        width: car.andon.width,
                        height: car.andon.height,
                        role: andons.length === 0 ? 'ticker' : 'credits',
                    });
                }
            });
            if (variation.pumpCar) {
                const car = buildParkedCar(materials, 'sedan', 'carPump', 'PumpCar', shadow);
                car.group.position.set(PUMP_CAR.x, LEVEL.apron, PUMP_CAR.z);
                car.group.rotation.y = Math.PI / 2;
                cars.push(car.group);
            }
            if (variation.keiTruck) {
                const car = buildParkedCar(materials, 'kei', 'carKei', 'KeiTruck', shadow);
                car.group.position.set(KEI_TRUCK.x, LEVEL.road, KEI_TRUCK.z);
                car.group.rotation.y = -Math.PI / 2;
                cars.push(car.group);
            }
            return {
                ground,
                canopy,
                pylon,
                motel,
                lamp,
                truck,
                andons,
                cars: group('Cars', ...cars),
                islands: buildIslands(materials),
                props: buildStationProps(materials),
            };
        });
        const { ground, canopy, pylon, motel, lamp, truck, andons } = built;
        this.world.name = 'Station/world';
        this.world.add(ground.group, canopy.group, built.islands, pylon.group, motel.group, lamp.group, truck.group, built.cars, built.props);
        // 亮的东西进倒影图层；罩棚和货厢也进：倒影镜头里它们是全黑的，正好当遮挡。
        this.world.traverse(object => {
            if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
            const isGlow = object.material.name.startsWith('machi:glow');
            const isOccluder = !object.material.transparent && (object.name.startsWith('Canopy/') || object.name === 'Truck/box');
            if (isGlow || isOccluder) object.layers.enable(MACHI_REFLECT_LAYER);
        });
        this.surfaces = { road: [ground.roadSurface], lot: ground.lotSurfaces };
        this.puddles = { offset: variation.puddleOffset, amount: variation.puddleAmount };
        bakeStatic(this.world);

        this.lights = new StationLights(blend, materials, lamp.head, motel.glow);
        this.signs = new StationSigns(materials, blend, {
            screen: { position: new THREE.Vector3(TRUCK_SCREEN.x, TRUCK_SCREEN.y, TRUCK_SCREEN.z), rotationY: 0, width: TRUCK_SCREEN.width, height: TRUCK_SCREEN.height },
            andons,
            canopy: [canopy.signFront, canopy.signRight],
            pylon: pylon.faces,
            motel: { tall: motel.tall, name: motel.name, vacancy: motel.vacancy, bulbs: motel.bulbs },
        });
        this.signs.group.traverse(object => {
            if (object instanceof THREE.Mesh) object.layers.enable(MACHI_REFLECT_LAYER);
        });

        const clipping = createBaseClippingPlanes(MACHI_BASE.half);
        this.traffic = withGeometryCache(geometryCache, () => new MachiTraffic(materials, blend, clipping, STATION_LANES, LEVEL.road));
        // 加油区前沿三面旗：セルフ、洗車、灯油。
        this.nobori = new MachiNobori(materials, [1.45, 1.95, 2.45].map(x => ({ x, y: LEVEL.apron, z: 0.15, rotationY: 0.4 })));
        this.lightCones = new MachiLightCones(materials, blend, [
            { apex: lamp.head, target: new THREE.Vector3(lamp.head.x - 0.4, LEVEL.road, lamp.head.z - 0.6), radius: 1.6, gain: 1 },
        ]);
        this.steam = new MachiSteam(materials, blend, [
            { position: truck.exhaust, puffs: 5, period: 3.2, size: 0.55 },
            { position: new THREE.Vector3(-2.6, LEVEL.road + 0.02, (ROAD.lanes[0] + ROAD.lanes[1]) / 2 + 0.4), puffs: 6, period: 4.6, size: 0.9 },
        ]);
        this.root.add(this.world, this.lights.group, this.signs.group, this.traffic.group, this.nobori.group, this.lightCones.mesh, this.steam.mesh);

        this.weather = {
            half: MACHI_BASE.half,
            groundY: LEVEL.apron * 0.5,
            roofs: [
                { x0: CANOPY.x0 - 0.05, z0: CANOPY.z0 - 0.05, x1: CANOPY.x1 + 0.05, z1: CANOPY.z1 + 0.05, y: CANOPY.top },
                { x0: TRUCK.rear, z0: TRUCK.z0, x1: TRUCK.boxFront, z1: TRUCK.z1, y: TRUCK.boxTop },
                { x0: TRUCK.cabBack, z0: TRUCK.z0, x1: TRUCK.front, z1: TRUCK.z1, y: TRUCK.cabTop },
            ],
            drips: stationDrips(),
            // 落进灯光里的雨丝被照亮：场地灯下、罩棚前、旅馆立牌旁。
            glints: [
                { position: new THREE.Vector3(lamp.head.x - 0.3, 2.4, lamp.head.z - 0.5), radius: 1.7 },
                { position: new THREE.Vector3((CANOPY.x0 + CANOPY.x1) / 2, 2.0, CANOPY.z1 + 0.6), radius: 2.2 },
                { position: motel.glow.clone(), radius: 1.6 },
            ],
            windYaw: variation.windYaw,
            windSlant: variation.windSlant,
        };
        this.framing = { points: stationFramingPoints(), view: { ...STATION_VIEW } };
        // 雾里的两处灯：罩棚下、场地灯下。
        this.glowA = new THREE.Vector4((CANOPY.x0 + CANOPY.x1) / 2, 0, (CANOPY.z0 + CANOPY.z1) / 2 + 1, 3.6);
        this.glowB = new THREE.Vector4(lamp.head.x - 0.4, 0, lamp.head.z - 0.6, 2.3);
        this.syncColors();
        context.invalidateShadows();
    }

    setContent(content: MachiSceneContent) {
        this.signs.setContent(content);
        const { palette } = content;
        this.nobori.paint({
            font: content.font,
            fallbacks: content.fallbacks,
            faces: [
                { background: palette.brand[0], ink: '#ffffff', text: 'セルフ' },
                { background: palette.brand[2], ink: '#ffffff', text: '洗車', icon: content.icons[0] },
                { background: palette.brand[1], ink: palette.signText, text: '灯油' },
            ],
        });
    }

    /** 换歌（seed 不变）：只重画招牌；seed 变了运行时会重建整个场景（rebuildsForSeed）。 */
    swapSong(_song: MachiSongContext, content: MachiSceneContent) {
        this.setContent(content);
    }

    direct(frame: MachiSceneFrame) {
        const { songTime, ambientTime, chorus, staticMode, environment, look } = frame;
        if (frame.targetChanged) this.signs.showBoard(frame.target, frame.lines, frame.immediate, frame.showText);
        else if (frame.preheat) this.signs.preheat(frame.preheat, frame.lines, frame.showText);
        const flicker = staticMode ? 1 : resolveMachiFlicker(ambientTime + 1.7, `${frame.seed}:canopy`, 0.4);
        const lampFlicker = staticMode ? 1 : resolveMachiFlicker(ambientTime + 4.2, `${frame.seed}:lamp`, 0.45);
        const lamp = look.streetLamps * (0.75 + 0.25 * lampFlicker);
        // 霓虹随拍（智能动感模式）：罩棚的灯（连同它投在地上的光斑）跟着小节慢慢涨落；旅馆的霓虹灯管是第三组，照到四周的
        // 霓虹光跟三组的平均；地面干时光斑跟鼓点跳。
        const { beat } = frame;
        const canopyLevel = (0.85 + 0.15 * flicker) * (1 + 0.08 * chorus) * look.artificial * beat.warm;
        const motelNeon = look.artificial * (0.8 + 0.2 * frame.flicker);
        this.lights.setLevels({
            canopy: canopyLevel,
            lamp,
            neon: motelNeon * beat.neon,
            screen: (1 - 0.8 * environment.daylight) * (1 + 0.2 * chorus),
            pools: (1 - 0.85 * environment.daylight) * (1 + beat.thump),
        });
        const materials = this.context.materials;
        materials.setGlowLevel('canopyLight', 0.4 + 0.6 * canopyLevel);
        materials.setGlowLevel('lampHead', 0.15 + 0.85 * look.streetLamps);
        materials.setGlowLevel('motelNeon', motelNeon * machiNeonGroup(beat, 2));
        materials.setGlowLevel('marker', 0.5 + 0.5 * look.artificial);
        // 停着的车白天不开灯，夜里出租车的灯亮着（等客）。
        materials.setGlowLevel('carHead', 0.12 + 0.88 * (1 - environment.daylight));
        materials.setGlowLevel('carTail', 0.3 + 0.7 * (1 - environment.daylight));
        materials.setGlowLevel('hazard', !staticMode && this.variation.hazardStall >= 0 && hazardOn(ambientTime, frame.seed) ? 1 : 0.06);
        // 会动的东西：车按氛围时钟，旗随风飘，排气与井盖的白气、场地灯的光柱慢慢流。静态模式下路上没有车。
        this.traffic.group.visible = !staticMode;
        this.traffic.update(ambientTime, frame.seed, frame.trafficChance);
        this.nobori.update(ambientTime, 0.35 + 0.65 * Math.min(1, frame.rain));
        this.lightCones.update(ambientTime, lamp * (1 - 0.6 * environment.daylight));
        this.steam.update(ambientTime, frame.atmosphere.wind);
        const night = 1 - 0.85 * environment.daylight;
        const atmosphere = frame.atmosphere;
        atmosphere.glowA.copy(this.glowA);
        atmosphere.glowB.copy(this.glowB);
        atmosphere.glowColorA.copy(this.context.blend.get('canopyLight')).multiplyScalar(0.5 * canopyLevel * night);
        atmosphere.glowColorB.copy(this.context.blend.get('streetLight')).multiplyScalar(0.42 * lamp * night);
        this.signs.update({
            songTime,
            ambientTime,
            delta: frame.delta,
            staticMode,
            chorus,
            audio: frame.audio,
            flicker: frame.flicker,
            artificial: look.artificial,
            lineIndex: frame.target.kind === 'line' ? frame.target.index : -1,
            beat,
        });
    }

    syncColors() {
        this.context.materials.syncColors();
        this.lights.sync();
        this.traffic.syncColors();
        this.lightCones.syncColors();
        this.steam.syncColors();
    }

    get busy() {
        return this.signs.busy;
    }

    nextCar(from: number, seed: string | number, chance: number) {
        for (let t = from; t < from + 120; t += 0.04) {
            const car = resolveMachiCar(t, seed, STATION_LANES, chance);
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
        this.textures.forEach(texture => texture.dispose());
        this.context.materials.dispose();
        this.root.removeFromParent();
    }
}

export const STATION_SCENE: MachiSceneDefinition = {
    resolveArt: resolveStationArt,
    create: context => new StationScene(context),
};
