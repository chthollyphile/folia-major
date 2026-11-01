import * as THREE from 'three';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import { buildMachiPlinth, MACHI_BASE, machiSurface } from '../../engine/geometry/plinth';
import { boxAt, boxSpan, cylinderAt, group, mesh, sagWire, tubeBetween } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import {
    BLOCKS,
    HANGING_SIGNS,
    HOLOGRAM,
    leftFaceAt,
    LEVEL,
    POLE,
    ROOF_BILLBOARD,
    SCREEN,
    SIGN_DEPTH,
    STALL,
    STALL_TABLE,
    VENDING,
    type KowloonHangingSign,
} from './layout';

// src/components/visualizer/machi/scenes/kowloon/street.ts
// 城寨酒吧的巷子：底座与地面（一整片湿地面，沿左排楼脚一道明渠、一个冒白气的沙井盖）、各家铺面（卷闸、冰室、
// 楼梯口、半开的卷闸透出暖光、通往深处的暗巷口与一根日光灯管）、伸出楼面的招牌箱与拉杆、B0 楼顶的广告架、
// 右前的大排档（绿铁皮档口、红白条帆布篷、一颗灯泡、镬与汤锅、折台与塑料凳）、电线杆（横担、变压器、街灯）、
// 横七竖八的电线、贩卖机、全息投影机的底座，以及几样杂物。招牌的字面另挂（kowloonSigns.ts），这里只给位置。

/** 一块招牌面：中心、朝向（绕 y）、宽高。 */
export interface KowloonPlacement {
    position: THREE.Vector3;
    rotationY: number;
    width: number;
    height: number;
}

export interface KowloonSignPlacement extends KowloonPlacement {
    vertical: boolean;
    role: KowloonHangingSign['role'] | 'billboard' | 'stall';
}

export interface KowloonStreetParts {
    group: THREE.Group;
    surface: THREE.Mesh;
    signs: KowloonSignPlacement[];
    /** 街灯灯头、档口灯泡、镬口（冒白气）、沙井盖。 */
    lampHead: THREE.Vector3;
    stallBulb: THREE.Vector3;
    wok: THREE.Vector3;
    manhole: THREE.Vector3;
    /** 招牌占的地方（楼面上的冷气机、铁笼让开它们）。 */
    signBoxes: THREE.Box3[];
    /** 楼脚的铺面、贩卖机、杂物各占的地方（墙上的水管碰到就不落地）。 */
    footing: THREE.Box3[];
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 伸出楼面的招牌占的盒子（含一点余量）。 */
export const hangingSignBox = (sign: KowloonHangingSign, margin = 0) => {
    const [a, b] = [Math.min(sign.wall, sign.tip), Math.max(sign.wall, sign.tip)];
    const half = SIGN_DEPTH / 2 + margin;
    return sign.axis === 'x'
        ? new THREE.Box3(v(a - margin, sign.y0 - margin, sign.at - half), v(b + margin, sign.y1 + margin, sign.at + half))
        : new THREE.Box3(v(sign.at - half, sign.y0 - margin, a - margin), v(sign.at + half, sign.y1 + margin, b + margin));
};

/** 不铺窗的地方：歌词屏（含外框）、楼顶广告架。 */
export const kowloonWindowAvoid = () => [
    new THREE.Box3(v(SCREEN.x - SCREEN.width / 2 - 0.25, SCREEN.y - SCREEN.height / 2 - 0.25, -1.9), v(SCREEN.x + SCREEN.width / 2 + 0.25, SCREEN.y + SCREEN.height / 2 + 0.1, -1.0)),
    new THREE.Box3(v(ROOF_BILLBOARD.x0 - 0.3, ROOF_BILLBOARD.y0 - 0.5, ROOF_BILLBOARD.z - 0.6), v(ROOF_BILLBOARD.x1 + 0.3, ROOF_BILLBOARD.y1 + 0.3, ROOF_BILLBOARD.z + 0.6)),
];

/** 歌词屏前面与上沿一层：楼面上伸出去的冷气机、晾衫竹不放这里，免得挡字。 */
export const kowloonScreenFront = () => new THREE.Box3(
    v(SCREEN.x - SCREEN.width / 2 - 0.4, SCREEN.y - SCREEN.height / 2 - 0.3, SCREEN.z - 0.2),
    v(SCREEN.x + SCREEN.width / 2 + 0.4, SCREEN.y + SCREEN.height / 2 + 1.2, SCREEN.z + 1.6),
);

/** 底座、地面、明渠、沙井盖。 */
const buildGround = (materials: MachiMaterials) => {
    const h = MACHI_BASE.half;
    const surface = machiSurface(materials.toon('concrete'), -h, h, -h, h, LEVEL.ground, 'Surface/alley');
    const surfaces = group('Base/Surfaces', surface);
    surfaces.userData.dynamic = true;
    const drain = materials.toon('drain');
    const curb = materials.toon('curb');
    const parts: THREE.Object3D[] = [];
    // 明渠：沿左排楼脚，楼面在哪就跟到哪；外沿一道矮路缘。
    BLOCKS.filter(block => block.name.startsWith('L')).forEach(block => {
        const z0 = Math.max(block.z0, -1.8);
        if (block.z1 <= z0) return;
        parts.push(boxSpan(drain, block.x1, block.x1 + 0.22, 0, LEVEL.ground + 0.004, z0, block.z1, { radius: 0, name: 'Drain' }));
        parts.push(boxSpan(curb, block.x1 + 0.22, block.x1 + 0.28, 0, LEVEL.ground + 0.05, z0, block.z1, { radius: 0.01, name: 'Curb' }));
    });
    const manhole = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 20), materials.toon('darkMetal'), { name: 'Manhole', castShadow: false });
    manhole.position.set(1.6, LEVEL.ground + 0.01, 4.1);
    parts.push(manhole);
    return { base: group('Base', buildMachiPlinth(materials), group('Base/Alley', ...parts), surfaces), surface, manhole: manhole.position.clone() };
};

/** 各家铺面：贴在楼面上的卷闸、玻璃、灯箱。 */
const buildShopfronts = (materials: MachiMaterials) => {
    const shutter = materials.toon('shutter');
    const shutterDark = materials.toon('shutterDark');
    const frame = materials.toon('windowFrame');
    const dark = materials.toon('windowDark');
    const parts: THREE.Object3D[] = [];
    const face = (name: string) => {
        const block = BLOCKS.find(candidate => candidate.name === name)!;
        return name.startsWith('L') ? block.x1 : block.z1;
    };
    /** 一道卷闸（沿 x，贴在 z 的墙面上）：横条纹、顶上的卷轴箱；open 是卷起来的高度。 */
    const shutterX = (x0: number, x1: number, z: number, top: number, open = 0) => {
        parts.push(boxSpan(shutterDark, x0 - 0.05, x1 + 0.05, top, top + 0.28, z, z + 0.2, { radius: 0.02, name: 'ShutterBox' }));
        for (let y = open; y < top - 0.05; y += 0.16) {
            parts.push(boxSpan(y % 0.32 < 0.16 ? shutter : shutterDark, x0, x1, y, Math.min(top, y + 0.15), z, z + 0.04, { radius: 0, name: 'Shutter' }));
        }
    };
    /** 同上，贴在 x 的墙面上（左排楼），沿 z。 */
    const shutterZ = (z0: number, z1: number, x: number, top: number, open = 0) => {
        parts.push(boxSpan(shutterDark, x, x + 0.2, top, top + 0.28, z0 - 0.05, z1 + 0.05, { radius: 0.02, name: 'ShutterBox' }));
        for (let y = open; y < top - 0.05; y += 0.16) {
            parts.push(boxSpan(y % 0.32 < 0.16 ? shutter : shutterDark, x, x + 0.04, y, Math.min(top, y + 0.15), z0, z1, { radius: 0, name: 'Shutter' }));
        }
    };
    /** 左排楼面上一个暗门洞（带门框）。 */
    const doorZ = (z0: number, z1: number, x: number, top = 2.3) => {
        parts.push(boxSpan(dark, x, x + 0.03, 0, top, z0, z1, { radius: 0, name: 'Door' }));
        parts.push(boxSpan(frame, x, x + 0.08, 0, top + 0.1, z0 - 0.07, z0, { radius: 0.01, name: 'Jamb' }));
        parts.push(boxSpan(frame, x, x + 0.08, 0, top + 0.1, z1, z1 + 0.07, { radius: 0.01, name: 'Jamb' }));
        parts.push(boxSpan(frame, x, x + 0.08, top, top + 0.12, z0 - 0.07, z1 + 0.07, { radius: 0.01, name: 'Jamb' }));
    };
    /** 左排楼面上一扇亮着的橱窗：发光的店里、竖框、踢脚。 */
    const windowZ = (z0: number, z1: number, x: number, glow: string) => {
        parts.push(boxSpan(materials.glow(glow), x, x + 0.02, 0.45, 2.3, z0, z1, { radius: 0, name: 'ShopGlow' }));
        const count = Math.max(1, Math.round((z1 - z0) / 0.65));
        for (let index = 0; index <= count; index += 1) {
            const z = z0 + ((z1 - z0) * index) / count;
            parts.push(boxSpan(frame, x, x + 0.07, 0.45, 2.3, z - 0.03, z + 0.03, { radius: 0.01, name: 'Mullion' }));
        }
        parts.push(boxSpan(frame, x, x + 0.08, 0, 0.45, z0 - 0.03, z1 + 0.03, { radius: 0.01, name: 'Kick' }));
        parts.push(boxSpan(frame, x, x + 0.08, 2.3, 2.42, z0 - 0.03, z1 + 0.03, { radius: 0.01, name: 'Head' }));
    };
    // B0：一道落了的卷闸。B0b（往里收一点）：一间亮着的冰室（暖光、竖框、两张卡座的剪影）。
    shutterX(-2.9, -1.7, face('B0'), 2.45);
    const cafe = face('B0b');
    parts.push(boxSpan(materials.glow('cafe'), -1.5, -0.42, 0.4, 2.4, cafe, cafe + 0.02, { radius: 0, name: 'ShopGlow' }));
    parts.push(boxSpan(frame, -1.56, -0.36, 0, 0.4, cafe, cafe + 0.08, { radius: 0.01, name: 'Kick' }));
    parts.push(boxSpan(frame, -1.56, -0.36, 2.4, 2.55, cafe, cafe + 0.08, { radius: 0.01, name: 'Head' }));
    [-1.53, -0.96, -0.39].forEach(x => parts.push(boxSpan(frame, x - 0.03, x + 0.03, 0.4, 2.4, cafe, cafe + 0.07, { radius: 0.01, name: 'Mullion' })));
    parts.push(boxSpan(dark, -1.42, -1.04, 0.4, 0.95, cafe + 0.02, cafe + 0.035, { radius: 0, name: 'Booth' }));
    parts.push(boxSpan(dark, -0.88, -0.5, 0.4, 0.95, cafe + 0.02, cafe + 0.035, { radius: 0, name: 'Booth' }));
    // L1：楼梯口与信箱。L2：亮着的药房。L3：卷闸半开，底下透出暖光。L4：暗门与一扇小面档的窗。L5：暗门。
    const l1 = face('L1');
    doorZ(-1.55, -0.85, l1);
    parts.push(boxSpan(materials.toon('rust'), l1, l1 + 0.1, 1.1, 1.6, -0.65, -0.32, { radius: 0.01, name: 'Mailbox' }));
    windowZ(0.0, 1.15, face('L2'), 'pharmacy');
    const l3 = face('L3');
    parts.push(boxSpan(materials.glow('shopWarm'), l3, l3 + 0.02, 0.02, 0.95, 1.45, 2.75, { radius: 0, name: 'ShopGlow' }));
    shutterZ(1.45, 2.75, l3, 2.5, 0.95);
    const l4 = face('L4');
    doorZ(3.05, 3.7, l4);
    windowZ(3.9, 4.4, l4, 'shopGlow');
    doorZ(4.8, 5.5, face('L5'), 2.2);
    // B2：通往城寨深处的暗巷口，门洞上一根日光灯管。
    const b2 = face('B2');
    parts.push(boxSpan(dark, 5.3, 5.95, 0, 2.4, b2, b2 + 0.03, { radius: 0, name: 'Passage' }));
    parts.push(boxSpan(frame, 5.22, 5.3, 0, 2.5, b2, b2 + 0.08, { radius: 0.01, name: 'Jamb' }));
    parts.push(boxSpan(materials.glow('tube'), 5.35, 5.9, 2.55, 2.59, b2, b2 + 0.06, { radius: 0.01, name: 'Tube' }));
    // 楼脚一道道电线、电表箱。
    const wire = materials.toon('wire');
    BLOCKS.filter(block => block.name.startsWith('L') && block.z1 > -1.8).forEach(block => {
        for (let z = block.z0 + 0.1; z < block.z1 - 0.3; z += 0.7) {
            parts.push(sagWire(wire, v(block.x1 + 0.05, 2.8, z), v(block.x1 + 0.05, 2.8, Math.min(block.z1 - 0.05, z + 0.7)), 0.06, 0.018));
        }
    });
    parts.push(boxSpan(materials.toon('ac'), l1, l1 + 0.12, 1.6, 2.1, -0.3, -0.18, { radius: 0.01, name: 'Meter' }));
    parts.push(boxSpan(materials.toon('ac'), -2.95, -2.6, 2.55, 2.85, face('B0'), face('B0') + 0.12, { radius: 0.01, name: 'Meter' }));
    return group('Shopfronts', ...parts);
};

/** 伸出楼面的招牌箱：箱体、拉杆；返回字面位置（左排楼的朝 +z，后排楼的朝 +x）。 */
const buildHangingSigns = (materials: MachiMaterials) => {
    const box = materials.toon('signBox');
    const rod = materials.toon('antenna');
    const parts: THREE.Object3D[] = [];
    const placements: KowloonSignPlacement[] = [];
    HANGING_SIGNS.forEach((sign, index) => {
        const bounds = hangingSignBox(sign);
        parts.push(boxSpan(box, bounds.min.x, bounds.max.x, bounds.min.y, bounds.max.y, bounds.min.z, bounds.max.z, { radius: 0.02, name: `Sign${index}` }));
        const length = Math.abs(sign.tip - sign.wall);
        const direction = Math.sign(sign.tip - sign.wall);
        // 拉杆：从墙上高处斜拉到招牌外端的上沿。
        const along = (offset: number, y: number) => (sign.axis === 'x' ? v(sign.wall + direction * offset, y, sign.at) : v(sign.at, y, sign.wall + direction * offset));
        parts.push(tubeBetween(rod, along(0, sign.y1 + 0.45), along(length * 0.85, sign.y1 + 0.02), 0.015, { name: 'Rod', castShadow: false }));
        parts.push(tubeBetween(rod, along(0, sign.y1 + 0.02), along(0.06, sign.y1 + 0.02), 0.03, { name: 'Rod', castShadow: false }));
        const width = length - 0.08;
        const height = sign.y1 - sign.y0 - 0.08;
        const mid = (sign.wall + sign.tip) / 2;
        const face = SIGN_DEPTH / 2 + 0.004;
        placements.push(sign.axis === 'x'
            ? { position: v(mid, (sign.y0 + sign.y1) / 2, sign.at + face), rotationY: 0, width, height, vertical: sign.vertical, role: sign.role }
            : { position: v(sign.at + face, (sign.y0 + sign.y1) / 2, mid), rotationY: Math.PI / 2, width, height, vertical: sign.vertical, role: sign.role });
    });
    return { group: group('HangingSigns', ...parts), placements };
};

/** B1 楼顶的广告架（在歌词屏正上方）：两根立柱、斜撑、背板。 */
const buildRoofBillboard = (materials: MachiMaterials) => {
    const steel = materials.toon('antenna');
    const { x0, x1, z, y0, y1 } = ROOF_BILLBOARD;
    const roof = BLOCKS.find(block => block.name === 'B1')!.height + 0.03;
    const parts: THREE.Object3D[] = [
        boxSpan(materials.toon('signBox'), x0, x1, y0, y1, z - 0.1, z, { radius: 0.02, name: 'Board' }),
    ];
    [x0 + 0.25, x1 - 0.25].forEach(x => {
        parts.push(boxSpan(steel, x - 0.04, x + 0.04, roof, y0 + 0.2, z - 0.14, z - 0.1, { radius: 0, name: 'Leg' }));
        parts.push(tubeBetween(steel, v(x, roof, z - 0.7), v(x, y0 + 0.1, z - 0.12), 0.02, { name: 'Brace', castShadow: false }));
    });
    parts.push(boxSpan(steel, x0, x1, y0 + 0.05, y0 + 0.1, z - 0.16, z - 0.1, { radius: 0, name: 'Rail' }));
    const placement: KowloonSignPlacement = { position: v((x0 + x1) / 2, (y0 + y1) / 2, z + 0.004), rotationY: 0, width: x1 - x0 - 0.06, height: y1 - y0 - 0.06, vertical: false, role: 'billboard' };
    return { group: group('Billboard', ...parts), placement };
};

/** 大排档：档口、帆布篷、灯泡、镬与汤锅、折台与塑料凳。 */
const buildStall = (materials: MachiMaterials) => {
    const green = materials.toon('stallGreen');
    const steel = materials.toon('chrome');
    const { x0, x1, z0, z1, counter, back, canopy } = STALL;
    const parts: THREE.Object3D[] = [
        boxSpan(green, x0, x1, 0, counter, z0, z1, { radius: 0.03, name: 'Kiosk' }),
        boxSpan(steel, x0 - 0.04, x1 + 0.04, counter, counter + 0.04, z0 - 0.04, z1 + 0.08, { radius: 0.01, name: 'Top' }),
        boxSpan(green, x0, x1, counter, back, z0, z0 + 0.06, { radius: 0.01, name: 'Back' }),
        boxSpan(green, x0, x0 + 0.05, counter, back, z0, z1, { radius: 0.01, name: 'Side' }),
        boxSpan(green, x1 - 0.05, x1, counter, back, z0, z1, { radius: 0.01, name: 'Side' }),
        boxSpan(materials.toon('slab'), x0 + 0.1, x1 - 0.1, 1.55, 1.58, z0 + 0.06, z0 + 0.3, { radius: 0, name: 'Shelf' }),
    ];
    // 招牌板：立在帆布篷后沿上面，两根短杆撑着（字面另挂）。
    const board = { x0: x0 + 0.2, x1: x1 - 0.2, y0: canopy + 0.12, y1: canopy + 0.52 };
    parts.push(boxSpan(materials.toon('signBox'), board.x0, board.x1, board.y0, board.y1, z0 - 0.1, z0 - 0.02, { radius: 0.015, name: 'Board' }));
    [board.x0 + 0.15, board.x1 - 0.15].forEach(x => parts.push(boxSpan(steel, x - 0.02, x + 0.02, back, board.y0, z0 - 0.08, z0 - 0.04, { radius: 0, name: 'BoardPost' })));
    // 帆布篷：红白条，从后板顶斜着伸到档口前面，前面两根杆撑着。
    const tarp = new THREE.Group();
    tarp.name = 'Tarp';
    const stripes = 8;
    const width = x1 - x0 + 0.3;
    const depth = z1 - z0 + 0.9;
    for (let index = 0; index < stripes; index += 1) {
        const stripe = mesh(new THREE.BoxGeometry(width / stripes, 0.025, depth), materials.toon(index % 2 ? 'tarpWhite' : 'tarpRed'), { name: 'Tarp' });
        stripe.position.set(-width / 2 + (index + 0.5) * (width / stripes), 0, depth / 2);
        tarp.add(stripe);
    }
    tarp.position.set((x0 + x1) / 2, canopy, z0 - 0.1);
    tarp.rotation.x = 0.2;
    parts.push(tarp);
    const front = z0 - 0.1 + depth * Math.cos(0.2) - 0.06;
    const frontY = canopy - depth * Math.sin(0.2);
    [x0 - 0.1, x1 + 0.1].forEach(x => parts.push(cylinderAt(steel, 0.025, frontY, [x, 0, front], { name: 'Pole', segments: 6 })));
    // 灯泡：篷下垂一颗。
    const bulb = v((x0 + x1) / 2 + 0.2, frontY - 0.35, (z1 + front) / 2);
    parts.push(cylinderAt(materials.toon('wire'), 0.006, 0.3, [bulb.x, bulb.y + 0.05, bulb.z], { name: 'Cord', segments: 4 }));
    const glow = mesh(new THREE.SphereGeometry(0.07, 10, 8), materials.glow('stallBulb'), { name: 'Bulb', castShadow: false });
    glow.position.copy(bulb);
    parts.push(glow);
    // 镬（炉头上一只黑镬）与汤锅。
    const wok = v(x0 + 0.5, counter + 0.04, (z0 + z1) / 2 + 0.1);
    parts.push(cylinderAt(materials.toon('darkMetal'), 0.2, 0.08, [wok.x, wok.y, wok.z], { name: 'Burner', segments: 12 }));
    const pan = mesh(new THREE.SphereGeometry(0.24, 14, 6, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), materials.toon('darkMetal'), { name: 'Wok' });
    pan.position.set(wok.x, wok.y + 0.32, wok.z);
    parts.push(pan);
    parts.push(cylinderAt(steel, 0.2, 0.36, [x1 - 0.45, counter + 0.04, (z0 + z1) / 2], { name: 'Pot', segments: 14 }));
    // 折台与四张塑料凳。
    const table = STALL_TABLE;
    parts.push(boxAt(materials.toon('table'), [0.85, 0.04, 0.85], [table.x, 0.7, table.z], { radius: 0.01, name: 'Table' }));
    [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]].forEach(([dx, dz]) => parts.push(boxAt(steel, [0.03, 0.7, 0.03], [table.x + dx!, 0, table.z + dz!], { radius: 0, name: 'TableLeg' })));
    [[-0.68, 0.1], [0.68, -0.05], [0.05, 0.7], [-0.1, -0.68]].forEach(([dx, dz], index) => {
        parts.push(cylinderAt(materials.toon(index % 3 === 2 ? 'stoolBlue' : 'plastic'), 0.15, 0.42, [table.x + dx!, 0, table.z + dz!], { name: 'Stool', segments: 10, radiusTop: 0.13 }));
    });
    const placement: KowloonSignPlacement = {
        position: v((board.x0 + board.x1) / 2, (board.y0 + board.y1) / 2, z0 - 0.016),
        rotationY: 0,
        width: board.x1 - board.x0 - 0.06,
        height: board.y1 - board.y0 - 0.06,
        vertical: false,
        role: 'stall',
    };
    return { group: group('Stall', ...parts), placement, bulb, wok: wok.clone().setY(counter + 0.45) };
};

/** 电线杆：杆、两道横担与瓷碗、变压器、街灯（灯臂伸向巷子）。返回灯头与横担上拉线的点。 */
const buildPole = (materials: MachiMaterials) => {
    const { x, z, height, lampArm, lampY } = POLE;
    const steel = materials.toon('antenna');
    const parts: THREE.Object3D[] = [
        cylinderAt(materials.toon('pole'), 0.12, height, [x, 0, z], { name: 'Pole', radiusTop: 0.085, segments: 10 }),
    ];
    const arms = [height - 0.35, height - 0.8];
    const anchors: THREE.Vector3[] = [];
    arms.forEach(y => {
        parts.push(boxSpan(steel, x - 0.05, x + 0.05, y - 0.05, y + 0.05, z - 0.65, z + 0.65, { radius: 0, name: 'Crossarm' }));
        [-0.55, -0.2, 0.2, 0.55].forEach(dz => {
            parts.push(cylinderAt(materials.toon('ac'), 0.03, 0.09, [x, y + 0.05, z + dz], { name: 'Insulator', segments: 6 }));
            anchors.push(v(x, y + 0.12, z + dz));
        });
    });
    parts.push(cylinderAt(materials.toon('tank'), 0.24, 0.62, [x + 0.3, height - 2.2, z], { name: 'Transformer', segments: 12 }));
    parts.push(boxSpan(steel, x + 0.05, x + 0.1, height - 2.0, height - 1.9, z - 0.04, z + 0.04, { radius: 0, name: 'Bracket' }));
    // 街灯：灯臂往前（+z）伸，灯头朝下，照在酒吧门右边，光柱不挡歌词屏。
    const head = v(x - 0.05, lampY + 0.12, z + lampArm);
    parts.push(tubeBetween(steel, v(x, lampY - 0.15, z + 0.1), v(head.x, head.y + 0.08, head.z - 0.2), 0.03, { name: 'LampArm' }));
    parts.push(boxSpan(materials.toon('darkMetal'), head.x - 0.13, head.x + 0.13, head.y, head.y + 0.1, head.z - 0.26, head.z + 0.26, { radius: 0.03, name: 'LampHead' }));
    parts.push(boxSpan(materials.glow('lampHead'), head.x - 0.09, head.x + 0.09, head.y - 0.02, head.y, head.z - 0.2, head.z + 0.2, { radius: 0, name: 'LampLens' }));
    return { group: group('Pole', ...parts), lampHead: head.clone().setY(head.y - 0.04), anchors };
};

/** 电线：电线杆横担往楼顶拉一把，左边楼面与后排楼面之间斜着交错一堆（都在招牌那一角，不横过歌词屏）。 */
const buildCables = (materials: MachiMaterials, anchors: THREE.Vector3[], random: () => number) => {
    const wire = materials.toon('wire');
    const parts: THREE.Object3D[] = [];
    const b1 = BLOCKS.find(block => block.name === 'B1')!;
    const b2 = BLOCKS.find(block => block.name === 'B2')!;
    const l1 = BLOCKS.find(block => block.name === 'L1')!;
    // 杆 → 后排楼顶、B2 楼顶、远远拉向左排楼的高处。
    anchors.slice(0, 4).forEach((anchor, index) => {
        const to = index < 2
            ? v(3.4 + index * 0.5, b1.height + 0.2, b1.z1 - 0.3 - index * 0.4)
            : v(b2.x0 + 0.4 + index * 0.2, b2.height + 0.15, b2.z1 - 0.2);
        parts.push(sagWire(wire, anchor, to, 0.15 + random() * 0.15, 0.013));
    });
    anchors.slice(4).forEach((anchor, index) => {
        const to = v(l1.x1, l1.height - 0.25 - index * 0.12, l1.z0 + 0.4 + index * 0.25);
        parts.push(sagWire(wire, anchor, to, 0.3 + random() * 0.2, 0.013));
    });
    // 左排楼面 ↔ 后排楼面：在巷子那一角上空交错。
    for (let index = 0; index < 11; index += 1) {
        const z = -1.6 + random() * 4.4;
        const from = v(leftFaceAt(z), 3.3 + random() * 2.8, z);
        const toX = -2.9 + random() * 2.5;
        const to = v(toX, 3.3 + random() * 2.7, toX < -1.6 ? -1.8 : -2.05);
        parts.push(sagWire(wire, from, to, 0.12 + random() * 0.35, 0.011));
    }
    return group('Cables', ...parts);
};

/** 贩卖机（发光的正面）、杂物（木箱、垃圾袋、石油气罐）、全息投影机的底座。 */
const buildProps = (materials: MachiMaterials, random: () => number) => {
    const parts: THREE.Object3D[] = [];
    const { x, z } = VENDING;
    parts.push(boxSpan(materials.toon('vendingBody'), x - 0.34, x + 0.34, 0, 1.8, z - 0.32, z + 0.28, { radius: 0.03, name: 'Vending' }));
    parts.push(boxSpan(materials.glow('vending'), x - 0.27, x + 0.27, 0.75, 1.65, z + 0.28, z + 0.3, { radius: 0, name: 'Vending/face' }));
    parts.push(boxSpan(materials.toon('windowDark'), x - 0.24, x + 0.24, 0.18, 0.4, z + 0.28, z + 0.31, { radius: 0.01, name: 'Vending' }));
    // 木箱一摞、几只垃圾袋、两罐石油气：L3 门口、L1 楼脚。
    const crate = materials.toon('crate');
    [[-3.45, 5.75, 0], [-3.45, 5.75, 0.36], [-3.0, 5.6, 0]].forEach(([cx, cz, cy]) => {
        parts.push(boxAt(crate, [0.5, 0.36, 0.42], [cx!, cy!, cz!], { radius: 0.02, name: 'Crate' }));
    });
    for (let index = 0; index < 4; index += 1) {
        const bag = mesh(new THREE.SphereGeometry(0.22, 10, 8), materials.toon('bag'), { name: 'Bag' });
        bag.scale.set(1, 0.75 + random() * 0.2, 0.9);
        bag.position.set(-3.05 + random() * 0.25, 0.16, -0.75 + index * 0.24 + random() * 0.1);
        parts.push(bag);
    }
    [[-3.1, 4.25], [-3.1, 3.95]].forEach(([cx, cz]) => {
        parts.push(cylinderAt(materials.toon('gas'), 0.13, 0.62, [cx!, LEVEL.ground, cz!], { name: 'Gas', segments: 10 }));
    });
    // 全息投影机：一只矮铁盒，顶上一圈发光的镜头。
    parts.push(boxAt(materials.toon('holoBase'), [0.46, 0.24, 0.46], [HOLOGRAM.x, 0, HOLOGRAM.z], { radius: 0.04, name: 'Projector' }));
    parts.push(cylinderAt(materials.glow('holoLens'), 0.13, 0.03, [HOLOGRAM.x, 0.24, HOLOGRAM.z], { name: 'Projector/lens', segments: 14 }));
    // 左排楼脚并排停着两架电单车；大排档旁一架木头手推车、一摞胶箱。
    [[-2.75, 4.75, 'scooterA'], [-2.75, 5.35, 'scooterB']].forEach(([sx, sz, color]) => {
        parts.push(buildScooter(materials, color as string, v(sx as number, LEVEL.ground, sz as number), Math.PI / 2 + (random() - 0.5) * 0.3));
    });
    const cart = materials.toon('crate');
    parts.push(boxAt(cart, [1.0, 0.06, 0.6], [3.25, 0.55, 3.55], { radius: 0.01, name: 'Cart' }));
    parts.push(boxAt(cart, [1.0, 0.18, 0.04], [3.25, 0.61, 3.27], { radius: 0.01, name: 'Cart' }));
    parts.push(boxAt(cart, [1.0, 0.18, 0.04], [3.25, 0.61, 3.83], { radius: 0.01, name: 'Cart' }));
    parts.push(tubeBetween(cart, v(2.75, 0.62, 3.3), v(2.35, 0.8, 3.3), 0.025, { name: 'Cart' }));
    parts.push(tubeBetween(cart, v(2.75, 0.62, 3.8), v(2.35, 0.8, 3.8), 0.025, { name: 'Cart' }));
    [3.27, 3.83].forEach(z => {
        const wheel = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 14), materials.toon('rubber'), { name: 'Cart' });
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(3.45, 0.24, z + (z < 3.5 ? -0.05 : 0.05));
        parts.push(wheel);
    });
    parts.push(boxAt(cart, [0.04, 0.32, 0.04], [2.85, 0.24, 3.55], { radius: 0, name: 'Cart' }));
    [[5.55, 2.8, 0], [5.55, 2.8, 0.3], [5.15, 2.75, 0]].forEach(([cx, cz, cy]) => {
        parts.push(boxAt(materials.toon('crateBlue'), [0.42, 0.3, 0.32], [cx!, cy!, cz!], { radius: 0.02, name: 'Crate' }));
    });
    return group('Props', ...parts);
};

/** 一架电单车（停着）：车身、踏板、座位、前挡、车头与把手、前后轮；车头朝 rotationY 方向的 +x。 */
const buildScooter = (materials: MachiMaterials, color: string, at: THREE.Vector3, rotationY: number) => {
    const body = materials.toon(color);
    const dark = materials.toon('rubber');
    const parts: THREE.Object3D[] = [
        boxSpan(body, -0.42, 0.05, 0.22, 0.55, -0.16, 0.16, { radius: 0.05, name: 'Body' }),
        boxSpan(body, 0.05, 0.42, 0.18, 0.26, -0.13, 0.13, { radius: 0.02, name: 'Floor' }),
        boxSpan(body, 0.38, 0.48, 0.2, 0.85, -0.17, 0.17, { radius: 0.04, name: 'Shield' }),
        boxSpan(dark, -0.4, 0.02, 0.55, 0.64, -0.13, 0.13, { radius: 0.04, name: 'Seat' }),
        boxSpan(materials.toon('chrome'), 0.45, 0.5, 0.85, 0.9, -0.24, 0.24, { radius: 0.01, name: 'Bar' }),
    ];
    [-0.38, 0.5].forEach(x => {
        const wheel = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), dark, { name: 'Wheel' });
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.16, 0);
        parts.push(wheel);
    });
    const scooter = group('Scooter', ...parts);
    scooter.position.copy(at);
    scooter.rotation.y = rotationY;
    return scooter;
};

/** 巷子里除了楼以外的固定几何。 */
export const buildKowloonStreet = (materials: MachiMaterials, seed: string | number): KowloonStreetParts => {
    const random = createVisualizerRng(`kowloon:street:${seed}`);
    const ground = buildGround(materials);
    const hanging = buildHangingSigns(materials);
    const billboard = buildRoofBillboard(materials);
    const stall = buildStall(materials);
    const pole = buildPole(materials);
    const cables = buildCables(materials, pole.anchors, random);
    const shopfronts = buildShopfronts(materials);
    const props = buildProps(materials, random);
    // 楼脚沿墙拉的电线不算（水管跟电线交叉无所谓）。
    const footing = [...shopfronts.children, ...props.children]
        .filter(part => !(part instanceof THREE.Mesh && part.geometry instanceof THREE.TubeGeometry))
        .map(part => new THREE.Box3().setFromObject(part));
    return {
        group: group('Street', ground.base, shopfronts, hanging.group, billboard.group, stall.group, pole.group, cables, props),
        surface: ground.surface,
        signs: [...hanging.placements, billboard.placement, stall.placement],
        lampHead: pole.lampHead,
        stallBulb: stall.bulb,
        wok: stall.wok,
        manhole: ground.manhole,
        signBoxes: HANGING_SIGNS.map(sign => hangingSignBox(sign, 0.08)),
        footing,
    };
};

/** 默认构图要框进去的点：底座顶面四角与两侧厚度、各栋楼顶的外角、广告架顶、电线杆顶。 */
export const kowloonFramingPoints = () => {
    const h = MACHI_BASE.half;
    const points: THREE.Vector3[] = [];
    [-h, h].forEach(x => [-h, h].forEach(z => {
        points.push(v(x, 0, z));
        if (z < 0 || x < 0) points.push(v(x, -MACHI_BASE.depth, z));
    }));
    BLOCKS.forEach(block => {
        points.push(v(block.x0, block.height + 0.3, block.z0), v(block.x1, block.height + 0.3, block.z0), v(block.x0, block.height + 0.3, block.z1));
    });
    points.push(v(ROOF_BILLBOARD.x0, ROOF_BILLBOARD.y1 + 0.1, ROOF_BILLBOARD.z), v(ROOF_BILLBOARD.x1, ROOF_BILLBOARD.y1 + 0.1, ROOF_BILLBOARD.z));
    points.push(v(POLE.x, POLE.height + 0.1, POLE.z));
    return points;
};
