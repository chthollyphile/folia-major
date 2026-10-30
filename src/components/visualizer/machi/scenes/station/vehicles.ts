import * as THREE from 'three';
import { boxAt, boxSpan, cylinderAt, group, mesh, tubeBetween } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { CAR, TRUCK } from './layout';

// src/components/visualizer/machi/scenes/station/vehicles.ts
// 停着的车：轿车、出租车（车顶一块 LED 顶灯，前挡风玻璃里亮着「空車」）、轻卡，与后排那辆アドトラック（货厢侧面是屏幕）。
// 车都在本地坐标里搭：车头朝 +z、底面在 y = 0，摆的时候再转。车身颜色走场景调色板的键（按 seed 选），灯是自发光件。

export type ParkedCarKind = 'sedan' | 'taxi' | 'kei';

export interface ParkedCarParts {
    group: THREE.Group;
    /** 出租车顶灯的 LED 面（本地坐标，朝 +z）。 */
    andon?: { position: THREE.Vector3; width: number; height: number };
}

const WHEEL_RADIUS = 0.27;

const wheel = (materials: MachiMaterials, x: number, z: number, radius = WHEEL_RADIUS, width = 0.2) => {
    const geometry = new THREE.CylinderGeometry(radius, radius, width, 14);
    geometry.rotateZ(Math.PI / 2);
    const result = mesh(geometry, materials.toon('rubber'), { name: 'Wheel' });
    result.position.set(x, radius, z);
    return result;
};

/** 一辆停着的车（轿车 / 出租车 / 轻卡）。bodyKey 是车身颜色的调色板键。 */
export const buildParkedCar = (
    materials: MachiMaterials,
    kind: ParkedCarKind,
    bodyKey: string,
    name: string,
    shadowMaterial: THREE.Material,
    /** 这辆车会打双闪（琥珀色小灯用会闪的那种自发光）。 */
    hazard = false,
): ParkedCarParts => {
    const hazardRole = hazard ? 'hazard' : 'hazardIdle';
    const length = kind === 'kei' ? 3.0 : CAR.length;
    const width = kind === 'kei' ? 1.36 : CAR.width;
    const half = length / 2;
    const body = materials.toon(bodyKey);
    const glass = materials.toon('carGlass');
    const dark = materials.toon('darkMetal');
    const parts: THREE.Object3D[] = [];
    let andon: ParkedCarParts['andon'];
    if (kind === 'kei') {
        // 轻卡：前面一个方头驾驶室，后面平板车斗带低栏板。
        parts.push(boxSpan(body, -width / 2, width / 2, 0.3, 0.72, -half, half, { radius: 0.06, name: 'Kei/chassis' }));
        parts.push(boxSpan(body, -width / 2 + 0.02, width / 2 - 0.02, 0.72, 1.42, half - 1.05, half, { radius: 0.1, name: 'Kei/cab' }));
        parts.push(boxSpan(glass, -width / 2 + 0.06, width / 2 - 0.06, 0.95, 1.36, half - 0.06, half + 0.005, { radius: 0.03, name: 'Kei/windshield' }));
        parts.push(boxSpan(glass, -width / 2 - 0.005, width / 2 + 0.005, 0.98, 1.34, half - 0.95, half - 0.2, { radius: 0.02, name: 'Kei/sideWindow' }));
        const bedBack = -half + 0.04;
        const bedFront = half - 1.12;
        [-1, 1].forEach(side => {
            parts.push(boxSpan(body, side * width / 2 - 0.03, side * width / 2 + 0.03, 0.72, 1.0, bedBack, bedFront, { radius: 0.01, name: 'Kei/sideGate' }));
        });
        parts.push(boxSpan(body, -width / 2, width / 2, 0.72, 1.0, bedBack - 0.03, bedBack + 0.03, { radius: 0.01, name: 'Kei/tailGate' }));
        parts.push(boxSpan(dark, -width / 2 + 0.06, width / 2 - 0.06, 1.42, 1.48, bedFront - 0.02, bedFront + 0.04, { radius: 0.01, name: 'Kei/guard' }));
    } else {
        parts.push(boxSpan(body, -width / 2, width / 2, 0.25, 0.8, -half, half, { radius: 0.14, name: 'Car/body' }));
        parts.push(boxSpan(glass, -width / 2 + 0.07, width / 2 - 0.07, 0.78, 1.3, -half * 0.62, half * 0.42, { radius: 0.12, name: 'Car/cabin' }));
        parts.push(boxSpan(body, -width / 2 + 0.08, width / 2 - 0.08, 1.27, 1.35, -half * 0.55, half * 0.32, { radius: 0.04, name: 'Car/roof' }));
        // 车门的竖缝与腰线：车身色的细条压一道深色。
        parts.push(boxSpan(dark, -width / 2 - 0.004, width / 2 + 0.004, 0.52, 0.54, -half + 0.3, half - 0.3, { radius: 0.005, name: 'Car/beltline' }));
        if (kind === 'taxi') {
            // 顶灯：车顶一块小灯箱，正面（+z）是 LED 屏。
            const andonY = 1.35;
            parts.push(boxSpan(dark, -0.5, 0.5, andonY, andonY + 0.05, -0.2, 0.12, { radius: 0.01, name: 'Taxi/andonBase' }));
            parts.push(boxSpan(materials.toon('taxiTrim'), -0.6, 0.6, andonY + 0.05, andonY + 0.43, -0.18, 0.1, { radius: 0.04, name: 'Taxi/andon' }));
            andon = { position: new THREE.Vector3(0, andonY + 0.24, 0.106), width: 1.08, height: 0.32 };
            // 前挡风玻璃里亮着的「空車」牌（红色）。
            const vacant = mesh(new THREE.PlaneGeometry(0.34, 0.11), materials.glow('vacant'), { name: 'Taxi/vacant', castShadow: false, receiveShadow: false });
            vacant.position.set(width / 2 - 0.42, 0.9, half * 0.42 + 0.004);
            parts.push(vacant);
            // 车身侧面一条腰线色带（出租车公司的色）。
            [-1, 1].forEach(side => {
                parts.push(boxSpan(materials.toon('taxiTrim'), side * (width / 2 + 0.004) - 0.004, side * (width / 2 + 0.004) + 0.004, 0.56, 0.66, -half + 0.25, half - 0.25, { radius: 0.003, name: 'Taxi/stripe' }));
            });
        }
    }
    // 前后保险杠、车灯、轮子。
    parts.push(boxSpan(dark, -width / 2 + 0.04, width / 2 - 0.04, 0.22, 0.38, half - 0.04, half + 0.04, { radius: 0.03, name: 'Bumper/front' }));
    parts.push(boxSpan(dark, -width / 2 + 0.04, width / 2 - 0.04, 0.22, 0.38, -half - 0.04, -half + 0.04, { radius: 0.03, name: 'Bumper/rear' }));
    [-1, 1].forEach(side => {
        const head = boxAt(materials.glow('carHead'), [0.3, 0.1, 0.04], [side * (width / 2 - 0.26), 0.58, half + 0.005], { radius: 0.02, name: 'Headlight', castShadow: false });
        const tail = boxAt(materials.glow('carTail'), [0.26, 0.1, 0.04], [side * (width / 2 - 0.22), 0.62, -half - 0.005], { radius: 0.02, name: 'Taillight', castShadow: false });
        // 双闪：前后各一盏琥珀色小灯（亮度由场景按时间表调）。
        const blinkFront = boxAt(materials.glow(hazardRole), [0.1, 0.06, 0.03], [side * (width / 2 - 0.06), 0.5, half + 0.012], { radius: 0.01, name: 'Hazard', castShadow: false });
        const blinkRear = boxAt(materials.glow(hazardRole), [0.1, 0.06, 0.03], [side * (width / 2 - 0.06), 0.5, -half - 0.012], { radius: 0.01, name: 'Hazard', castShadow: false });
        parts.push(head, tail, blinkFront, blinkRear);
        // 后视镜。
        if (kind !== 'kei') parts.push(boxAt(body, [0.14, 0.08, 0.06], [side * (width / 2 + 0.05), 0.92, half * 0.36], { radius: 0.02, name: 'Mirror' }));
    });
    const axle = half - (kind === 'kei' ? 0.5 : 0.62);
    // 轮子外侧比车身侧面凸出一点：齐平的话轮胎和车身侧面同在一个面上，会互相闪。
    [[-1, axle], [1, axle], [-1, -axle], [1, -axle]].forEach(([side, z]) => parts.push(wheel(materials, side! * (width / 2 - 0.085), z!)));
    // 车下一块软影（车停着也有落地感，不靠阴影图）。
    const shadow = mesh(new THREE.PlaneGeometry(width + 0.5, length + 0.5).rotateX(-Math.PI / 2), shadowMaterial, { name: 'Shadow', castShadow: false, receiveShadow: false });
    shadow.position.y = 0.004;
    parts.push(shadow);
    return { group: group(name, ...parts), andon };
};

/** 后排的アドトラック：车头朝 +x，货厢侧面（+z）是屏幕。返回屏幕框的位置（世界坐标）与排气管口。 */
export const buildAdTruck = (materials: MachiMaterials, shadowMaterial: THREE.Material) => {
    const T = TRUCK;
    const zc = (T.z0 + T.z1) / 2;
    const width = T.z1 - T.z0;
    const dark = materials.toon('darkMetal');
    const box = materials.toon('truckBox');
    const cab = materials.toon('truckCab');
    const glass = materials.toon('carGlass');
    const parts: THREE.Object3D[] = [];
    // 车架与货厢。
    parts.push(boxSpan(dark, T.rear + 0.1, T.front - 0.2, 0.55, T.deck, zc - 0.7, zc + 0.7, { radius: 0.04, name: 'Truck/frame' }));
    parts.push(boxSpan(box, T.rear, T.boxFront, T.deck, T.boxTop, T.z0, T.z1, { radius: 0.07, name: 'Truck/box' }));
    // 屏幕的黑框：比屏幕大一圈，贴在货厢侧面。
    parts.push(boxSpan(dark, T.rear + 0.12, T.boxFront - 0.12, T.deck + 0.14, T.boxTop - 0.08, T.z1 - 0.02, T.z1 + 0.02, { radius: 0.02, name: 'Truck/bezel' }));
    // 货厢顶沿、底沿一排琥珀色示廓灯。
    const markerSpacing = (T.boxFront - T.rear - 0.4) / 7;
    for (let index = 0; index <= 7; index += 1) {
        const x = T.rear + 0.2 + index * markerSpacing;
        parts.push(boxAt(materials.glow('marker'), [0.1, 0.05, 0.03], [x, T.boxTop - 0.05, T.z1 + 0.02], { radius: 0.01, name: 'Marker', castShadow: false }));
        parts.push(boxAt(materials.glow('marker'), [0.1, 0.05, 0.03], [x, T.deck + 0.02, T.z1 + 0.02], { radius: 0.01, name: 'Marker', castShadow: false }));
    }
    // 车头：方头驾驶室、挡风玻璃、侧窗、遮阳板、保险杠、大灯。
    parts.push(boxSpan(cab, T.cabBack, T.front, 0.75, T.cabTop, T.z0 + 0.05, T.z1 - 0.05, { radius: 0.12, name: 'Truck/cab' }));
    parts.push(boxSpan(glass, T.front - 0.03, T.front + 0.005, 1.55, T.cabTop - 0.25, T.z0 + 0.18, T.z1 - 0.18, { radius: 0.03, name: 'Truck/windshield' }));
    [T.z0 + 0.045, T.z1 - 0.045].forEach(z => {
        parts.push(boxSpan(glass, T.front - 0.75, T.front - 0.12, 1.6, T.cabTop - 0.3, z - 0.01, z + 0.01, { radius: 0.02, name: 'Truck/sideWindow' }));
    });
    parts.push(boxSpan(dark, T.front - 0.05, T.front + 0.06, T.cabTop - 0.2, T.cabTop - 0.12, T.z0 + 0.1, T.z1 - 0.1, { radius: 0.02, name: 'Truck/visor' }));
    parts.push(boxSpan(dark, T.front - 0.1, T.front + 0.08, 0.45, 0.85, T.z0 + 0.04, T.z1 - 0.04, { radius: 0.04, name: 'Truck/bumper' }));
    [T.z0 + 0.32, T.z1 - 0.32].forEach(z => {
        parts.push(boxAt(materials.glow('carHead'), [0.04, 0.14, 0.3], [T.front + 0.085, 0.86, z], { radius: 0.02, name: 'Truck/headlight', castShadow: false }));
    });
    parts.push(boxSpan(dark, T.front - 0.03, T.front + 0.01, 0.95, 1.45, (T.z0 + T.z1) / 2 - 0.45, (T.z0 + T.z1) / 2 + 0.45, { radius: 0.02, name: 'Truck/grille' }));
    // 后视镜（支在驾驶室两侧）。
    [T.z0 - 0.08, T.z1 + 0.08].forEach(z => {
        parts.push(tubeBetween(dark, new THREE.Vector3(T.front - 0.2, 2.05, z > zc ? T.z1 - 0.05 : T.z0 + 0.05), new THREE.Vector3(T.front - 0.05, 2.05, z), 0.02, { name: 'Truck/mirrorArm' }));
        parts.push(boxAt(dark, [0.06, 0.38, 0.14], [T.front - 0.03, 1.86, z], { radius: 0.02, name: 'Truck/mirror' }));
    });
    // 排气管（驾驶室后面竖起来）、油箱、挡泥板。
    const stack = new THREE.Vector3(T.cabBack - 0.1, T.cabTop + 0.35, T.z1 - 0.18);
    parts.push(cylinderAt(materials.toon('metal'), 0.07, stack.y - 1.0, [stack.x, 1.0, stack.z], { segments: 10, name: 'Truck/stack' }));
    parts.push(cylinderAt(materials.toon('metal'), 0.22, 0.9, [T.cabBack + 0.55, 0.12, T.z1 - 0.3], { segments: 14, name: 'Truck/tank' }).rotateZ(Math.PI / 2));
    // 轮子：后面双轴，前面一轴。
    const wheelZ = width / 2 - 0.22;
    [T.rear + 0.95, T.rear + 1.95, T.front - 0.9].forEach(x => {
        [-1, 1].forEach(side => parts.push(wheel(materials, x, zc + side * wheelZ, 0.45, 0.32)));
    });
    // 车下软影。
    const shadow = mesh(new THREE.PlaneGeometry(T.front - T.rear + 0.6, width + 0.6).rotateX(-Math.PI / 2), shadowMaterial, { name: 'Truck/shadow', castShadow: false, receiveShadow: false });
    shadow.position.set((T.front + T.rear) / 2, 0.004, zc);
    parts.push(shadow);
    // 车轮是绕 z 的圆柱（沿 x 摆的车），转一下。
    parts.filter(part => part.name === 'Wheel').forEach(part => part.rotateY(Math.PI / 2));
    return { group: group('Truck', ...parts), exhaust: stack.clone().setY(stack.y + 0.05) };
};
