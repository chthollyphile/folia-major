import * as THREE from 'three';
import { buildMachiPlinth, MACHI_BASE, machiSurface } from '../../engine/geometry/plinth';
import { boxAt, boxSpan, cylinderAt, group, mesh, tubeBetween } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import {
    APRON,
    APRON_PROPS,
    CANOPY,
    ISLANDS,
    LEVEL,
    LOT_LAMP,
    MOTEL_SIGN,
    PYLON,
    ROAD,
    STALLS,
    STATION_VIEW,
} from './layout';

// src/components/visualizer/machi/scenes/station/structures.ts
// 加油站停车场的固定几何：底座与路（一条路、路缘与两处出入口、车道线、停车位线与车轮挡）、抬高的加油区、
// 罩棚（四根柱子、底面一排灯板、四边的品牌条）、两座加油岛与四台加油机、路边的价格立柱、汽车旅馆的高立牌、场地灯，
// 以及几样小道具。招牌的字面另挂（stationSigns.ts），这里只返回它们的位置。

/** 一块招牌面：中心、朝向（绕 y）、宽高。 */
export interface StationPlacement {
    position: THREE.Vector3;
    rotationY: number;
    width: number;
    height: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 底座、路、停车场、加油区的地面。 */
export const buildStationGround = (materials: MachiMaterials) => {
    const h = MACHI_BASE.half;
    const roadSurface = machiSurface(materials.toon('asphalt'), -h, h, -h, h, LEVEL.road, 'Surface/road');
    const apronSurface = machiSurface(materials.toon('concrete'), APRON.x0, APRON.x1, APRON.z0, APRON.z1, LEVEL.apron, 'Surface/apron');
    const surfaces = group('Base/Surfaces', roadSurface, apronSurface);
    surfaces.userData.dynamic = true;
    const concrete = materials.toon('concrete');
    const curb = materials.toon('curb');
    const parts: THREE.Object3D[] = [];
    // 加油区：抬高一点的混凝土板，前沿是一道斜坡似的路缘。
    parts.push(boxSpan(concrete, APRON.x0 + 0.002, APRON.x1 - 0.002, LEVEL.road, LEVEL.apron - 0.004, APRON.z0 + 0.002, APRON.z1 - 0.002, { radius: 0.02, name: 'Apron/slab' }));
    // 路缘：停车场与路之间，在出入口断开。
    const curbZ0 = ROAD.z0 - ROAD.curb;
    let from = -h;
    [...ROAD.gaps, [h, h] as const].forEach(([gap0, gap1]) => {
        if (gap0 - from > 0.05) parts.push(boxSpan(curb, from, gap0, LEVEL.road, 0.12, curbZ0, ROAD.z0, { radius: 0.02, name: 'Curb' }));
        from = gap1;
    });
    // 路面的白漆：中线（虚线）、两侧边线、停车位线（InstancedMesh 一种白漆）。
    const bars: { x: number; z: number; w: number; d: number }[] = [];
    const mid = (ROAD.lanes[0] + ROAD.lanes[1]) / 2;
    for (let x = -h + 0.3; x < h - 0.6; x += 1.4) bars.push({ x: x + 0.4, z: mid, w: 0.8, d: 0.1 });
    bars.push({ x: 0, z: ROAD.z0 + 0.22, w: h * 2, d: 0.08 });
    bars.push({ x: 0, z: ROAD.z1 - 0.2, w: h * 2, d: 0.08 });
    const stallEdges = [STALLS.x[0] - STALLS.width / 2, ...STALLS.x.map(x => x + STALLS.width / 2)];
    stallEdges.forEach(x => bars.push({ x, z: STALLS.z, w: 0.09, d: STALLS.depth }));
    bars.push({ x: (stallEdges[0]! + stallEdges[stallEdges.length - 1]!) / 2, z: STALLS.z - STALLS.depth / 2, w: stallEdges[stallEdges.length - 1]! - stallEdges[0]! + 0.09, d: 0.09 });
    const paintGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const paint = new THREE.InstancedMesh(paintGeometry, materials.toon('roadPaint'), bars.length);
    paint.name = 'Base/Paint';
    paint.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    bars.forEach((bar, index) => {
        matrix.makeScale(bar.w, 1, bar.d);
        matrix.setPosition(bar.x, LEVEL.road + 0.006, bar.z);
        paint.setMatrixAt(index, matrix);
    });
    parts.push(paint);
    // 车轮挡：每个车位后面一块。
    STALLS.x.forEach(x => {
        parts.push(boxAt(materials.toon('curb'), [0.9, 0.1, 0.16], [x, LEVEL.road, STALLS.z - STALLS.depth / 2 + 0.45], { radius: 0.03, name: 'WheelStop' }));
    });
    // 井盖。
    const manhole = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 24), materials.toon('darkMetal'), { name: 'Manhole', castShadow: false });
    manhole.position.set(-2.6, LEVEL.road + 0.01, mid + 0.4);
    parts.push(manhole);
    const base = group('Base', buildMachiPlinth(materials), group('Base/Lot', ...parts), surfaces);
    return { group: base, roadSurface, lotSurfaces: [apronSurface] };
};

/** 罩棚：柱子、顶板、四边的品牌条、底面的灯板。返回前沿招牌面。 */
export const buildCanopy = (materials: MachiMaterials) => {
    const C = CANOPY;
    const parts: THREE.Object3D[] = [];
    parts.push(boxSpan(materials.toon('canopyUnder'), C.x0, C.x1, C.under, C.top - 0.06, C.z0, C.z1, { radius: 0.04, name: 'Canopy/deck' }));
    parts.push(boxSpan(materials.toon('canopyTop'), C.x0 - 0.04, C.x1 + 0.04, C.top - 0.08, C.top, C.z0 - 0.04, C.z1 + 0.04, { radius: 0.03, name: 'Canopy/lid' }));
    // 四边的品牌条：一道主色宽条、一道副色细条。
    const band = (role: string, y0: number, y1: number, inset: number) => {
        const material = materials.toon(role);
        const o = 0.02 + inset;
        parts.push(boxSpan(material, C.x0 - o, C.x1 + o, y0, y1, C.z1 - 0.02, C.z1 + o, { radius: 0.01, name: `Canopy/band:${role}` }));
        parts.push(boxSpan(material, C.x0 - o, C.x1 + o, y0, y1, C.z0 - o, C.z0 + 0.02, { radius: 0.01, name: `Canopy/band:${role}` }));
        parts.push(boxSpan(material, C.x1 - 0.02, C.x1 + o, y0, y1, C.z0 - o, C.z1 + o, { radius: 0.01, name: `Canopy/band:${role}` }));
        parts.push(boxSpan(material, C.x0 - o, C.x0 + 0.02, y0, y1, C.z0 - o, C.z1 + o, { radius: 0.01, name: `Canopy/band:${role}` }));
    };
    band('brand0', C.under - 0.02, C.under + 0.14, 0.01);
    band('brand2', C.under + 0.16, C.under + 0.21, 0.012);
    // 柱子：方柱，半腰一道品牌色，脚下一圈黄黑的防撞护栏。
    C.columns.forEach(([x, z], index) => {
        parts.push(boxAt(materials.toon('canopyColumn'), [0.32, C.under - LEVEL.apron, 0.32], [x, LEVEL.apron, z], { radius: 0.03, name: `Canopy/column${index}` }));
        parts.push(boxAt(materials.toon('brand0'), [0.34, 0.5, 0.34], [x, 1.4, z], { radius: 0.03, name: 'Canopy/columnBand' }));
        parts.push(boxAt(materials.toon('caution'), [0.5, 0.42, 0.5], [x, LEVEL.apron, z], { radius: 0.05, name: 'Canopy/guard' }));
    });
    // 底面的灯板：两排各三块，自发光。
    const lights: THREE.Vector3[] = [];
    for (let row = 0; row < 2; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            const x = C.x0 + 0.85 + col * ((C.x1 - C.x0 - 1.7) / 2);
            const z = C.z0 + 1.2 + row * (C.z1 - C.z0 - 2.4);
            const panel = mesh(new THREE.PlaneGeometry(0.9, 0.5).rotateX(Math.PI / 2), materials.glow('canopyLight'), { name: 'Canopy/light', castShadow: false, receiveShadow: false });
            panel.position.set(x, C.under - 0.005, z);
            parts.push(panel);
            lights.push(v(x, C.under - 0.05, z));
        }
    }
    const signFront: StationPlacement = {
        position: v((C.x0 + C.x1) / 2, C.top - 0.2, C.z1 + 0.035),
        rotationY: 0,
        width: 2.3,
        height: 0.34,
    };
    const signRight: StationPlacement = {
        position: v(C.x1 + 0.035, C.top - 0.2, (C.z0 + C.z1) / 2),
        rotationY: Math.PI / 2,
        width: 2.3,
        height: 0.34,
    };
    return { group: group('Canopy', ...parts), lights, signFront, signRight };
};

/** 两座加油岛，各两台加油机（机身、顶上的品牌色灯箱、两面的小屏、油枪与软管）。 */
export const buildIslands = (materials: MachiMaterials) => {
    const I = ISLANDS;
    const parts: THREE.Object3D[] = [];
    const dark = materials.toon('darkMetal');
    I.z.forEach((z, islandIndex) => {
        parts.push(boxSpan(materials.toon('concrete'), I.x0, I.x1, LEVEL.apron, LEVEL.apron + I.height, z - I.width / 2, z + I.width / 2, { radius: 0.05, name: 'Island' }));
        // 岛两头黄黑的护柱。
        [I.x0 + 0.12, I.x1 - 0.12].forEach(x => {
            parts.push(cylinderAt(materials.toon('caution'), 0.06, 0.75, [x, LEVEL.apron + I.height, z], { segments: 10, name: 'Island/bollard' }));
        });
        I.pumps.forEach((x, pumpIndex) => {
            const y0 = LEVEL.apron + I.height;
            parts.push(boxAt(materials.toon('pumpBody'), [0.55, 1.45, 0.36], [x, y0, z], { radius: 0.05, name: `Pump${islandIndex}${pumpIndex}` }));
            parts.push(boxAt(materials.toon('brand0'), [0.58, 0.24, 0.39], [x, y0 + 1.45, z], { radius: 0.04, name: 'Pump/crown' }));
            [-1, 1].forEach(side => {
                const screen = mesh(new THREE.PlaneGeometry(0.34, 0.2), materials.glow('pumpScreen'), { name: 'Pump/screen', castShadow: false, receiveShadow: false });
                screen.position.set(x, y0 + 1.05, z + side * 0.185);
                if (side < 0) screen.rotation.y = Math.PI;
                parts.push(screen);
                // 油枪挂在机身两侧，软管垂下来再接回去。
                const holster = v(x + side * 0.3, y0 + 0.8, z);
                parts.push(boxAt(dark, [0.08, 0.2, 0.12], [holster.x, holster.y - 0.1, holster.z], { radius: 0.02, name: 'Pump/nozzle' }));
                const hoseTop = v(x + side * 0.2, y0 + 1.3, z);
                const hoseLow = v(x + side * 0.42, y0 + 0.35, z + 0.05);
                parts.push(tubeBetween(dark, hoseTop, hoseLow, 0.025, { name: 'Pump/hose', castShadow: false }));
                parts.push(tubeBetween(dark, hoseLow, holster, 0.025, { name: 'Pump/hose', castShadow: false }));
            });
        });
    });
    return group('Islands', ...parts);
};

/** 路边的价格立柱：两根柱子托一块高灯箱。返回两面招牌（朝前、朝后）。 */
export const buildPylon = (materials: MachiMaterials) => {
    const P = PYLON;
    const rotationY = STATION_VIEW.azimuth * 0.6;
    const root = new THREE.Group();
    root.name = 'Pylon';
    const boxBottom = 0.9;
    const boxHeight = P.height - boxBottom;
    root.add(
        boxAt(materials.toon('darkMetal'), [0.1, boxBottom + 0.1, 0.14], [-P.width * 0.3, LEVEL.road, 0], { radius: 0.02, name: 'Post' }),
        boxAt(materials.toon('darkMetal'), [0.1, boxBottom + 0.1, 0.14], [P.width * 0.3, LEVEL.road, 0], { radius: 0.02, name: 'Post' }),
        boxAt(materials.toon('canopyFascia'), [P.width, boxHeight, 0.22], [0, boxBottom, 0], { radius: 0.05, name: 'Box' }),
        boxAt(materials.toon('brand0'), [P.width + 0.04, 0.08, 0.26], [0, P.height - 0.02, 0], { radius: 0.02, name: 'Cap' }),
        boxAt(materials.toon('concrete'), [P.width + 0.2, 0.16, 0.5], [0, LEVEL.road, 0], { radius: 0.03, name: 'Footing' }),
    );
    root.position.set(P.x, 0, P.z);
    root.rotation.y = rotationY;
    const faceWidth = P.width - 0.08;
    const faceHeight = boxHeight - 0.1;
    const center = v(0, boxBottom + boxHeight / 2, 0);
    const faces: StationPlacement[] = [1, -1].map(side => {
        const local = center.clone().setZ(side * 0.115).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
        return { position: local.add(v(P.x, 0, P.z)), rotationY: rotationY + (side > 0 ? 0 : Math.PI), width: faceWidth, height: faceHeight };
    });
    return { group: root, faces };
};

/**
 * 汽车旅馆的高立牌：一根柱子，顶上一块竖的「MOTEL」灯箱，下面一块写名字的横牌、一个「VACANCY」小灯箱，
 * 一支指向下方的箭头（边上一圈走马灯泡）。整块牌朝着默认镜头。返回各块字面与箭头的轮廓（世界坐标）。
 */
export const buildMotelSign = (materials: MachiMaterials) => {
    const M = MOTEL_SIGN;
    const root = new THREE.Group();
    root.name = 'MotelSign';
    const back = materials.toon('motelBack');
    const neonTrim = materials.glow('motelNeon');
    root.add(cylinderAt(materials.toon('motelPole'), 0.11, M.height, [0, LEVEL.road, 0], { radiusTop: 0.09, segments: 12, name: 'Pole' }));
    root.add(cylinderAt(materials.toon('concrete'), 0.3, 0.2, [0, LEVEL.road, 0], { segments: 14, name: 'Footing' }));
    // 竖灯箱：「MOTEL」五个字母竖排。灯箱都比杆子粗（杆子半径约 0.1），杆子整根藏在灯箱里，不会从字面上穿出来。
    const tall = { w: 0.86, h: 2.5, y0: M.height - 2.55, x: 0.38 };
    root.add(boxAt(back, [tall.w, tall.h, 0.26], [tall.x, tall.y0, 0], { radius: 0.06, name: 'Tall' }));
    root.add(boxAt(neonTrim, [tall.w + 0.06, 0.04, 0.3], [tall.x, tall.y0 + tall.h, 0], { radius: 0.01, name: 'Tall/trim', castShadow: false }));
    root.add(boxAt(neonTrim, [tall.w + 0.06, 0.04, 0.3], [tall.x, tall.y0 - 0.04, 0], { radius: 0.01, name: 'Tall/trim', castShadow: false }));
    // 名字横牌与 VACANCY 小灯箱。
    const name = { w: 2.1, h: 0.62, y0: tall.y0 - 0.85, x: 0.55 };
    root.add(boxAt(back, [name.w, name.h, 0.26], [name.x, name.y0, 0], { radius: 0.05, name: 'Name' }));
    const vacancy = { w: 1.3, h: 0.34, y0: name.y0 - 0.5, x: 0.7 };
    root.add(boxAt(back, [vacancy.w, vacancy.h, 0.24], [vacancy.x, vacancy.y0, 0], { radius: 0.04, name: 'Vacancy' }));
    // 箭头：从竖灯箱右边弯下来，指向地面（扁平的形状，正面一圈灯泡另挂）。
    const arrow = new THREE.Shape();
    const ax = tall.x + tall.w / 2;
    const top = tall.y0 + tall.h * 0.78;
    const neck = name.y0 + name.h + 0.28;
    arrow.moveTo(ax, top);
    arrow.lineTo(ax + 0.85, top);
    arrow.lineTo(ax + 0.85, neck);
    arrow.lineTo(ax + 1.12, neck);
    arrow.lineTo(ax + 0.65, name.y0 + name.h + 0.02);
    arrow.lineTo(ax + 0.18, neck);
    arrow.lineTo(ax + 0.45, neck);
    arrow.lineTo(ax + 0.45, top - 0.4);
    arrow.lineTo(ax, top - 0.4);
    arrow.closePath();
    const arrowGeometry = new THREE.ExtrudeGeometry(arrow, { depth: 0.12, bevelEnabled: false });
    arrowGeometry.translate(0, 0, -0.06);
    root.add(mesh(arrowGeometry, materials.toon('brand0'), { name: 'Arrow' }));
    const rotationY = STATION_VIEW.azimuth;
    root.position.set(M.x, 0, M.z);
    root.rotation.y = rotationY;
    root.updateMatrixWorld(true);
    const world = (x: number, y: number, z: number) => v(x, y, z).applyMatrix4(root.matrixWorld);
    const face = (x: number, y: number, width: number, height: number, depth: number): StationPlacement => ({
        position: world(x, y, depth),
        rotationY,
        width,
        height,
    });
    // 箭头轮廓上的灯泡位置（世界坐标），按轮廓走一圈的顺序。
    const outline = arrow.getPoints(1);
    const bulbs: THREE.Vector3[] = [];
    for (let index = 0; index < outline.length - 1; index += 1) {
        const a = outline[index]!;
        const b = outline[index + 1]!;
        const steps = Math.max(1, Math.round(a.distanceTo(b) / 0.16));
        for (let step = 0; step < steps; step += 1) {
            const p = a.clone().lerp(b, step / steps);
            bulbs.push(world(p.x, p.y, 0.075));
        }
    }
    return {
        group: root,
        tall: face(tall.x, tall.y0 + tall.h / 2, tall.w - 0.12, tall.h - 0.12, 0.135),
        name: face(name.x, name.y0 + name.h / 2, name.w - 0.1, name.h - 0.1, 0.135),
        vacancy: face(vacancy.x, vacancy.y0 + vacancy.h / 2, vacancy.w - 0.08, vacancy.h - 0.06, 0.125),
        bulbs,
        rotationY,
        glow: world(0.8, tall.y0 + 0.5, 0.6),
    };
};

/** 场地灯：一根高杆，臂伸向停车场，灯头朝下。返回灯头（世界坐标）。 */
export const buildLotLamp = (materials: MachiMaterials) => {
    const L = LOT_LAMP;
    const metal = materials.toon('pole');
    const top = LEVEL.road + L.height;
    const parts: THREE.Object3D[] = [
        cylinderAt(metal, 0.085, L.height, [L.x, LEVEL.road, L.z], { radiusTop: 0.06, segments: 10, name: 'Pole' }),
        cylinderAt(materials.toon('darkMetal'), 0.13, 0.3, [L.x, LEVEL.road, L.z], { segments: 10, name: 'Foot' }),
        tubeBetween(metal, v(L.x, top - 0.15, L.z), v(L.x - L.arm, top + 0.05, L.z - 0.4), 0.04, { name: 'Arm' }),
        boxAt(materials.toon('darkMetal'), [0.6, 0.1, 0.3], [L.x - L.arm - 0.1, top - 0.04, L.z - 0.45], { radius: 0.04, name: 'Head', rotationY: 0.3 }),
    ];
    const lens = mesh(new THREE.PlaneGeometry(0.5, 0.22).rotateX(Math.PI / 2), materials.glow('lampHead'), { name: 'Lens', castShadow: false, receiveShadow: false });
    lens.position.set(L.x - L.arm - 0.1, top - 0.045, L.z - 0.45);
    lens.rotation.y = 0.3;
    parts.push(lens);
    return { group: group('LotLamp', ...parts), head: v(L.x - L.arm - 0.1, top - 0.06, L.z - 0.45) };
};

/** 小道具：充气机、轮胎堆、垃圾箱、机油架。 */
export const buildStationProps = (materials: MachiMaterials) => {
    const parts: THREE.Object3D[] = [];
    const dark = materials.toon('darkMetal');
    const { airPump, bins, tires } = APRON_PROPS;
    // 充气机：罩棚左前柱外侧。
    parts.push(boxAt(materials.toon('brand2'), [airPump.width, 1.1, airPump.depth], [airPump.x, LEVEL.apron, airPump.z], { radius: 0.04, name: 'AirPump' }));
    parts.push(tubeBetween(dark, v(airPump.x + 0.1, LEVEL.apron + 0.95, airPump.z + 0.15), v(airPump.x + 0.3, LEVEL.apron + 0.1, airPump.z + 0.3), 0.02, { name: 'AirPump/hose', castShadow: false }));
    // 轮胎堆：右边加油岛的尽头。
    const tire = new THREE.TorusGeometry(0.26, 0.11, 8, 18).rotateX(Math.PI / 2);
    for (let index = 0; index < 4; index += 1) {
        const ring = mesh(tire, materials.toon('rubber'), { name: 'Tire' });
        ring.position.set(tires.x, LEVEL.apron + 0.11 + index * 0.21, tires.z);
        parts.push(ring);
    }
    // 垃圾箱（两格，充气机后面排成一列）与机油架。
    bins.z.forEach((z, index) => {
        parts.push(boxAt(materials.toon(index === 0 ? 'brand0' : 'brand2'), [bins.size, 0.78, bins.size], [bins.x, LEVEL.apron, z], { radius: 0.03, name: 'Bin' }));
    });
    parts.push(boxAt(materials.toon('canopyColumn'), [0.9, 1.0, 0.32], [5.3, LEVEL.apron, -5.55], { radius: 0.03, name: 'OilRack' }));
    for (let index = 0; index < 6; index += 1) {
        parts.push(boxAt(materials.toon(`product${index}`), [0.1, 0.18, 0.08], [4.95 + (index % 3) * 0.32, LEVEL.apron + 1.0 + Math.floor(index / 3) * 0.0, -5.42], { radius: 0.01, name: 'OilCan' }));
    }
    return group('StationProps', ...parts);
};

/** 默认构图要框进去的点：底座顶面四角与两侧厚度、罩棚顶、货车顶、旅馆立牌顶。 */
export const stationFramingPoints = () => {
    const h = MACHI_BASE.half;
    const points: THREE.Vector3[] = [];
    [-h, h].forEach(x => [-h, h].forEach(z => {
        points.push(v(x, 0, z));
        if (z < 0 || x < 0) points.push(v(x, -MACHI_BASE.depth, z));
    }));
    points.push(v(CANOPY.x0, CANOPY.top, CANOPY.z0), v(CANOPY.x1, CANOPY.top, CANOPY.z0), v(CANOPY.x1, CANOPY.top, CANOPY.z1));
    points.push(v(MOTEL_SIGN.x, MOTEL_SIGN.height + 0.2, MOTEL_SIGN.z));
    points.push(v(-5.9, 3.5, -5.7), v(1.1, 3.5, -5.7));
    return points;
};
