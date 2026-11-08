import * as THREE from 'three';
import type { MachiMaterials } from '../../engine/materials';
import { MACHI_REFLECT_LAYER } from '../../engine/fx/reflection';
import { BOARD, DOOR, FASCIA, LEVEL, STORE } from './layout';
import { boxSpan, cylinderAt, group, mesh, roundedBox, tubeBetween } from '../../engine/geometry/shapes';

// src/components/visualizer/machi/scenes/konbini/store.ts
// 便利店 Group "Store"：地坪、实墙（外墙 + 内衬）、前右两面落地玻璃与窗框、对开自动门（两扇，会动）、
// 屋顶与女儿墙、绕一圈的店招带（底板 + 三色条）、落水管，以及屋顶的三面广告塔骨架与射灯。
// 招牌的字面（店招、广告塔三面）只留出位置，贴图由 konbiniSigns 挂上。

export interface KonbiniStoreParts {
    group: THREE.Group;
    /** 两扇门：x 方向滑开；closedX 是关着时的中心。 */
    doorPanels: { object: THREE.Object3D; closedX: number; direction: -1 | 1 }[];
    /** 广告塔三面的放置（面中心、朝向），招牌模块按它挂字面。 */
    boardFaces: { position: THREE.Vector3; rotationY: number }[];
    /** 店招的两块面：前面、右面（中心、朝向、宽高）。 */
    fasciaFaces: { position: THREE.Vector3; rotationY: number; width: number; height: number }[];
    /** 广告塔顶盖：中心、三角形（形状坐标 = (x - cx, -(z - cz))）、顶面高度。招牌模块在上面画屋顶 logo。 */
    boardLid: { center: THREE.Vector3; shape: THREE.Vector2[]; topY: number };
}

const { x0, x1, z0, z1, wall } = STORE;

/** 地坪与实墙（外墙一层、内衬一层，透过玻璃看到的是内衬的颜色）。 */
const buildShell = (materials: MachiMaterials) => {
    const outer = materials.toon('wall');
    const lining = materials.toon('interiorWall');
    const floor = materials.toon('interiorFloor');
    const frame = materials.toon('frame');
    const h = STORE.wallHeight;
    const parts: THREE.Object3D[] = [
        boxSpan(floor, x0, x1, LEVEL.lot - 0.02, LEVEL.floor, z0, z1, { radius: 0.01, name: 'Floor' }),
        // 后墙、左墙、右面后段实墙、前面左端墙垛。
        boxSpan(outer, x0, x1, LEVEL.floor, h, z0, z0 + wall, { name: 'Wall/back' }),
        boxSpan(outer, x0, x0 + wall, LEVEL.floor, h, z0, z1, { name: 'Wall/left' }),
        boxSpan(outer, x1 - wall, x1, LEVEL.floor, h, z0, STORE.rightGlassEnd, { name: 'Wall/rightSolid' }),
        boxSpan(outer, x0, STORE.frontPillarEnd, LEVEL.floor, h, z1 - wall, z1, { name: 'Wall/frontPillar' }),
        // 玻璃上沿到屋顶之间的横梁（店招挂在它外面）。
        boxSpan(outer, x0, x1, STORE.glassTop, h, z1 - wall, z1, { name: 'Wall/frontTransom' }),
        boxSpan(outer, x1 - wall, x1, STORE.glassTop, h, STORE.rightGlassEnd, z1, { name: 'Wall/rightTransom' }),
        // 内衬：比外墙薄一点，往里退。
        boxSpan(lining, x0 + wall, x1 - wall, LEVEL.floor, h - 0.05, z0 + wall, z0 + wall + 0.02, { radius: 0.005, name: 'Lining/back' }),
        boxSpan(lining, x0 + wall, x0 + wall + 0.02, LEVEL.floor, h - 0.05, z0 + wall, z1 - wall, { radius: 0.005, name: 'Lining/left' }),
        boxSpan(lining, x1 - wall - 0.02, x1 - wall, LEVEL.floor, h - 0.05, z0 + wall, STORE.rightGlassEnd, { radius: 0.005, name: 'Lining/right' }),
        // 转角立柱与玻璃下沿的踢脚。
        boxSpan(frame, x1 - 0.12, x1, LEVEL.floor, STORE.glassTop, z1 - 0.12, z1, { radius: 0.015, name: 'CornerPost' }),
        boxSpan(frame, STORE.frontPillarEnd, x1, LEVEL.floor, STORE.glassBottom, z1 - 0.1, z1, { radius: 0.01, name: 'Kick/front' }),
        boxSpan(frame, x1 - 0.1, x1, LEVEL.floor, STORE.glassBottom, STORE.rightGlassEnd, z1, { radius: 0.01, name: 'Kick/right' }),
        boxSpan(frame, STORE.frontPillarEnd, x1, STORE.glassTop - 0.05, STORE.glassTop + 0.02, z1 - 0.1, z1, { radius: 0.01, name: 'Head/front' }),
        boxSpan(frame, x1 - 0.1, x1, STORE.glassTop - 0.05, STORE.glassTop + 0.02, STORE.rightGlassEnd, z1, { radius: 0.01, name: 'Head/right' }),
    ];
    return group('Store/Shell', ...parts);
};

/** 落地玻璃：前面门两侧、右面前段；竖框约每 1.25m 一根。 */
const buildGlazing = (materials: MachiMaterials) => {
    const glass = materials.glass;
    const frame = materials.toon('frame');
    const bottom = STORE.glassBottom;
    const top = STORE.glassTop - 0.05;
    const height = top - bottom;
    const parts: THREE.Object3D[] = [];
    const pane = (width: number, x: number, z: number, rotationY: number, name: string) => {
        const geometry = new THREE.PlaneGeometry(width, height);
        const result = mesh(geometry, glass, { name, castShadow: false, receiveShadow: false });
        result.position.set(x, bottom + height / 2, z);
        result.rotation.y = rotationY;
        result.renderOrder = 2;
        return result;
    };
    const frontSpans: [number, number][] = [[STORE.frontPillarEnd, DOOR.x0 - 0.08], [DOOR.x1 + 0.08, x1 - 0.12]];
    frontSpans.forEach(([a, b], index) => {
        parts.push(pane(b - a, (a + b) / 2, z1 - 0.05, 0, `Glass/front${index}`));
        const count = Math.max(1, Math.round((b - a) / 1.25));
        for (let i = 0; i <= count; i += 1) {
            const x = a + ((b - a) * i) / count;
            parts.push(boxSpan(frame, x - 0.03, x + 0.03, bottom, top, z1 - 0.09, z1 - 0.01, { radius: 0.01, name: 'Mullion' }));
        }
    });
    // 只在倒影里出现的“橱窗光”：店里亮着的那一片，倒影不用再把整个店内画一遍。
    const windowGlow = materials.glow('warmWindow');
    const standIn = (width: number, x: number, z: number, rotationY: number) => {
        const plane = mesh(new THREE.PlaneGeometry(width, height * 0.92), windowGlow, { name: 'ReflectionWindow', castShadow: false, receiveShadow: false });
        plane.position.set(x, bottom + height * 0.5, z);
        plane.rotation.y = rotationY;
        plane.layers.set(MACHI_REFLECT_LAYER);
        parts.push(plane);
    };
    standIn(x1 - STORE.frontPillarEnd - 0.2, (STORE.frontPillarEnd + x1) / 2, z1 - 0.2, 0);
    standIn(z1 - STORE.rightGlassEnd - 0.2, x1 - 0.2, (z1 + STORE.rightGlassEnd) / 2, Math.PI / 2);
    const rightSpan: [number, number] = [STORE.rightGlassEnd, z1 - 0.12];
    parts.push(pane(rightSpan[1] - rightSpan[0], x1 - 0.05, (rightSpan[0] + rightSpan[1]) / 2, Math.PI / 2, 'Glass/right'));
    const rightCount = Math.max(1, Math.round((rightSpan[1] - rightSpan[0]) / 1.25));
    for (let i = 0; i <= rightCount; i += 1) {
        const z = rightSpan[0] + ((rightSpan[1] - rightSpan[0]) * i) / rightCount;
        parts.push(boxSpan(frame, x1 - 0.09, x1 - 0.01, bottom, top, z - 0.03, z + 0.03, { radius: 0.01, name: 'Mullion' }));
    }
    return group('Store/Glazing', ...parts);
};

/** 对开自动门：门框、门上感应器、两扇带框的玻璃门（各自是一个会动的 Group）。 */
const buildDoor = (materials: MachiMaterials) => {
    const frame = materials.toon('frame');
    const darkMetal = materials.toon('darkMetal');
    const glass = materials.glass;
    const panelHeight = DOOR.height - LEVEL.floor - 0.02;
    const mid = (DOOR.x0 + DOOR.x1) / 2;
    const z = z1 + 0.035;
    const parts: THREE.Object3D[] = [
        boxSpan(frame, DOOR.x0 - 0.08, DOOR.x0, LEVEL.floor, STORE.glassTop, z1 - 0.1, z1 + 0.08, { radius: 0.01, name: 'Jamb/left' }),
        boxSpan(frame, DOOR.x1, DOOR.x1 + 0.08, LEVEL.floor, STORE.glassTop, z1 - 0.1, z1 + 0.08, { radius: 0.01, name: 'Jamb/right' }),
        boxSpan(frame, DOOR.x0 - 0.9, DOOR.x1 + 0.9, DOOR.height, DOOR.height + 0.16, z1 - 0.02, z1 + 0.1, { radius: 0.015, name: 'Header' }),
        boxSpan(darkMetal, mid - 0.18, mid + 0.18, DOOR.height - 0.07, DOOR.height, z1 + 0.04, z1 + 0.11, { radius: 0.012, name: 'Sensor' }),
        // 门里门外的地垫。
        boxSpan(materials.toon('rubber'), DOOR.x0 - 0.1, DOOR.x1 + 0.1, LEVEL.lot, LEVEL.lot + 0.012, z1 + 0.12, z1 + 0.85, { radius: 0.006, name: 'Mat/out' }),
        boxSpan(materials.toon('rubber'), DOOR.x0, DOOR.x1, LEVEL.floor, LEVEL.floor + 0.01, z1 - 0.9, z1 - 0.12, { radius: 0.006, name: 'Mat/in' }),
    ];
    // 门上方的固定玻璃。
    const transom = mesh(new THREE.PlaneGeometry(DOOR.x1 - DOOR.x0, STORE.glassTop - DOOR.height - 0.16), glass, { name: 'Glass/transom', castShadow: false, receiveShadow: false });
    transom.position.set(mid, (DOOR.height + 0.16 + STORE.glassTop) / 2, z1 - 0.05);
    transom.renderOrder = 2;
    parts.push(transom);

    const panels: KonbiniStoreParts['doorPanels'] = [];
    ([-1, 1] as const).forEach(direction => {
        const w = DOOR.panelWidth;
        const panelGlass = mesh(new THREE.PlaneGeometry(w - 0.1, panelHeight - 0.14), glass, { name: 'Glass', castShadow: false, receiveShadow: false });
        panelGlass.position.set(0, panelHeight / 2 + 0.02, 0);
        panelGlass.renderOrder = 2;
        const rails = [
            boxSpan(frame, -w / 2, -w / 2 + 0.05, 0, panelHeight, -0.025, 0.025, { radius: 0.01, name: 'Stile' }),
            boxSpan(frame, w / 2 - 0.05, w / 2, 0, panelHeight, -0.025, 0.025, { radius: 0.01, name: 'Stile' }),
            boxSpan(frame, -w / 2, w / 2, 0, 0.09, -0.025, 0.025, { radius: 0.01, name: 'Rail' }),
            boxSpan(frame, -w / 2, w / 2, panelHeight - 0.05, panelHeight, -0.025, 0.025, { radius: 0.01, name: 'Rail' }),
            boxSpan(darkMetal, -0.02, 0.02, 0.9, 1.25, 0.025, 0.045, { radius: 0.008, name: 'Pull' }),
        ];
        const panel = group(direction < 0 ? 'Door/left' : 'Door/right', ...rails, panelGlass);
        panel.userData.dynamic = true;
        const closedX = mid + direction * (w / 2 - 0.02);
        panel.position.set(closedX, LEVEL.floor + 0.01, z);
        panels.push({ object: panel, closedX, direction });
        parts.push(panel);
    });
    return { group: group('Store/Door', ...parts), panels };
};

/** 屋顶、女儿墙、落水管。 */
const buildRoof = (materials: MachiMaterials) => {
    const roof = materials.toon('roof');
    const trim = materials.toon('trim');
    const o = STORE.overhang;
    const top = STORE.roofTop;
    const p = STORE.parapetTop;
    const t = 0.1;
    const parts: THREE.Object3D[] = [
        boxSpan(roof, x0 - o, x1 + o, STORE.wallHeight, top, z0 - o, z1 + o, { radius: 0.025, name: 'Slab' }),
        boxSpan(trim, x0 - o, x1 + o, top, p, z0 - o, z0 - o + t, { radius: 0.02, name: 'Parapet/back' }),
        boxSpan(trim, x0 - o, x1 + o, top, p, z1 + o - t, z1 + o, { radius: 0.02, name: 'Parapet/front' }),
        boxSpan(trim, x0 - o, x0 - o + t, top, p, z0 - o, z1 + o, { radius: 0.02, name: 'Parapet/left' }),
        boxSpan(trim, x1 + o - t, x1 + o, top, p, z0 - o, z1 + o, { radius: 0.02, name: 'Parapet/right' }),
    ];
    // 落水管：前左角，从女儿墙下沿顺墙到地面，底部一个弯头朝外。
    const pipe = materials.toon('metal');
    const px = x0 - 0.06;
    const pz = z1 - 0.12;
    parts.push(cylinderAt(pipe, 0.045, top - LEVEL.lot - 0.2, [px, LEVEL.lot + 0.2, pz], { segments: 10, name: 'Downspout' }));
    parts.push(tubeBetween(pipe, new THREE.Vector3(px, LEVEL.lot + 0.22, pz), new THREE.Vector3(px - 0.05, LEVEL.lot + 0.06, pz + 0.2), 0.045, { name: 'Downspout/elbow' }));
    parts.push(tubeBetween(pipe, new THREE.Vector3(px, top - 0.02, pz), new THREE.Vector3(px + 0.18, top - 0.02, pz + 0.2), 0.04, { name: 'Downspout/head' }));
    return group('Store/Roof', ...parts);
};

/** 店招带：前面、右面各一块灯箱底板，上沿一条、下沿两条三色条。字面贴图另挂。 */
const buildFascia = (materials: MachiMaterials) => {
    const base = materials.toon('signBase');
    const d = FASCIA.depth;
    const parts: THREE.Object3D[] = [
        boxSpan(base, x0 - 0.02, x1 + d, FASCIA.y0, FASCIA.y1, z1, z1 + d, { radius: 0.03, name: 'Board/front' }),
        boxSpan(base, x1, x1 + d, FASCIA.y0, FASCIA.y1, z0 + 0.4, z1 + d - 0.01, { radius: 0.03, name: 'Board/right' }),
    ];
    const stripes: [KonbiniMaterialRole, number, number][] = [
        ['brand0', FASCIA.y1 - 0.07, FASCIA.y1 - 0.01],
        ['brand2', FASCIA.y0 + 0.1, FASCIA.y0 + 0.15],
        ['brand0', FASCIA.y0 + 0.03, FASCIA.y0 + 0.08],
    ];
    stripes.forEach(([role, y0, y1], index) => {
        const material = materials.toon(role);
        parts.push(boxSpan(material, x0 - 0.01, x1 + d + 0.01, y0, y1, z1 + d - 0.02, z1 + d + 0.008, { radius: 0.006, name: `Stripe/front${index}` }));
        parts.push(boxSpan(material, x1 + d - 0.02, x1 + d + 0.008, y0, y1, z0 + 0.41, z1 + d, { radius: 0.006, name: `Stripe/right${index}` }));
    });
    const textHeight = (FASCIA.y1 - 0.08) - (FASCIA.y0 + 0.16);
    const textY = (FASCIA.y1 - 0.08 + FASCIA.y0 + 0.16) / 2;
    const faces: KonbiniStoreParts['fasciaFaces'] = [
        { position: new THREE.Vector3((x0 + x1) / 2, textY, z1 + d + 0.006), rotationY: 0, width: x1 - x0 - 0.2, height: textHeight },
        { position: new THREE.Vector3(x1 + d + 0.006, textY, (z0 + 0.4 + z1) / 2), rotationY: Math.PI / 2, width: z1 - z0 - 0.6, height: textHeight },
    ];
    return { group: group('Store/Fascia', ...parts), faces };
};

type KonbiniMaterialRole = 'brand0' | 'brand1' | 'brand2';

/** 屋顶的三面广告塔：三角柱，每面一块自发光屏幕（屏幕自己亮，不要射灯），三根立柱与斜撑、顶盖。 */
const buildBoardTower = (materials: MachiMaterials) => {
    const steel = materials.toon('darkMetal');
    const trim = materials.toon('trim');
    const W = BOARD.faceWidth;
    const H = BOARD.faceHeight;
    const inradius = W / (2 * Math.sqrt(3));
    const circumradius = W / Math.sqrt(3);
    const center = new THREE.Vector3(BOARD.cx, 0, BOARD.cz);
    const parts: THREE.Object3D[] = [];
    const faces: KonbiniStoreParts['boardFaces'] = [];
    const vertices: THREE.Vector3[] = [];
    for (let k = 0; k < 3; k += 1) {
        const a = BOARD.azimuth + (k * 2 * Math.PI) / 3;
        const normal = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        const position = center.clone().addScaledVector(normal, inradius + 0.012);
        position.y = BOARD.y0 + H / 2;
        faces.push({ position, rotationY: a });
        // 顶点在相邻两面法线的中间方向上。
        const va = a + Math.PI / 3;
        vertices.push(center.clone().add(new THREE.Vector3(Math.sin(va) * circumradius, 0, Math.cos(va) * circumradius)));
    }
    // 三块屏幕的机箱：每面一块有厚度的背板，字面贴在外侧；上下沿各一根横梁。中间是空的，从上往下看得见屋顶。
    for (let k = 0; k < 3; k += 1) {
        const a = BOARD.azimuth + (k * 2 * Math.PI) / 3;
        const normal = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
        const panelCenter = center.clone().addScaledVector(normal, inradius - 0.07);
        const panel = mesh(roundedBox(W + 0.06, H + 0.16, 0.14, 0.03), steel, { name: `Panel${k}` });
        panel.position.set(panelCenter.x, BOARD.y0 + H / 2, panelCenter.z);
        panel.rotation.y = a;
        parts.push(panel);
        [BOARD.y0 + H + 0.1, BOARD.y0 - 0.1].forEach((y, index) => {
            const beam = mesh(roundedBox(W + 0.14, 0.09, 0.2, 0.02), trim, { name: index === 0 ? 'TopBeam' : 'BottomBeam' });
            const beamCenter = center.clone().addScaledVector(normal, inradius - 0.04);
            beam.position.set(beamCenter.x, y, beamCenter.z);
            beam.rotation.y = a;
            parts.push(beam);
        });
        // 顶沿一条霓虹灯带（主题的霓虹色），让塔顶读作亮着的招牌，而不是一块暗的屋顶。
        const rim = mesh(roundedBox(W + 0.1, 0.04, 0.04, 0.012), materials.glow('neonRim'), { name: 'NeonRim', castShadow: false, receiveShadow: false });
        const rimCenter = center.clone().addScaledVector(normal, inradius + 0.075);
        rim.position.set(rimCenter.x, BOARD.y0 + H + 0.1, rimCenter.z);
        rim.rotation.y = a;
        parts.push(rim);
    }
    // 顶盖：一块薄三角板盖住屏幕机箱内侧，从上往下看是一块平顶，不是空心的三角。
    const lidShape = new THREE.Shape();
    vertices.forEach((vertex, index) => {
        const local = vertex.clone().sub(center).multiplyScalar(1.01);
        if (index === 0) lidShape.moveTo(local.x, -local.z);
        else lidShape.lineTo(local.x, -local.z);
    });
    lidShape.closePath();
    const lidGeometry = new THREE.ExtrudeGeometry(lidShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.015, bevelSegments: 1 });
    lidGeometry.rotateX(-Math.PI / 2);
    const lid = mesh(lidGeometry, materials.toon('metal'), { name: 'Lid' });
    lid.position.set(center.x, BOARD.y0 + H + 0.08, center.z);
    parts.push(lid);
    // 立柱：顶点处从屋顶到顶盖，加斜撑。
    vertices.forEach((vertex, index) => {
        const inward = center.clone().sub(vertex).setY(0).normalize();
        const foot = vertex.clone().addScaledVector(inward, 0.18);
        parts.push(cylinderAt(steel, 0.06, BOARD.y0 + H + 0.1 - STORE.roofTop, [foot.x, STORE.roofTop, foot.z], { segments: 8, name: `Post${index}` }));
        const brace = foot.clone().addScaledVector(inward, 0.9);
        parts.push(tubeBetween(steel, new THREE.Vector3(brace.x, STORE.roofTop, brace.z), new THREE.Vector3(foot.x, BOARD.y0 - 0.1, foot.z), 0.03, { name: 'Brace' }));
        parts.push(boxSpan(trim, brace.x - 0.14, brace.x + 0.14, STORE.roofTop, STORE.roofTop + 0.06, brace.z - 0.14, brace.z + 0.14, { radius: 0.01, name: 'BracePad' }));
    });
    const lidTop = BOARD.y0 + H + 0.08 + 0.06 + 0.015;
    const lidShapePoints = vertices.map(vertex => {
        const local = vertex.clone().sub(center).multiplyScalar(1.01);
        return new THREE.Vector2(local.x, -local.z);
    });
    return { group: group('Store/BoardTower', ...parts), faces, lid: { center, shape: lidShapePoints, topY: lidTop } };
};

export const buildKonbiniStore = (materials: MachiMaterials, interior: THREE.Object3D): KonbiniStoreParts => {
    const door = buildDoor(materials);
    const fascia = buildFascia(materials);
    const tower = buildBoardTower(materials);
    const store = group(
        'Store',
        buildShell(materials),
        buildGlazing(materials),
        door.group,
        buildRoof(materials),
        fascia.group,
        tower.group,
        interior,
    );
    return {
        group: store,
        doorPanels: door.panels,
        boardFaces: tower.faces,
        fasciaFaces: fascia.faces,
        boardLid: tower.lid,
    };
};
