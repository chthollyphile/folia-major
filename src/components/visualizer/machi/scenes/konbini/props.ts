import * as THREE from 'three';
import type { MachiMaterials } from '../../engine/materials';
import type { KonbiniVariation } from './konbiniSeed';
import type { KonbiniProductBatch } from './interior';
import { BASE, DEG, LEVEL, PROPS, STORE } from './layout';
import { boxAt, boxSpan, cylinderAt, group, mesh, roundedBox, sagWire, tubeBetween } from '../../engine/geometry/shapes';

// src/components/visualizer/machi/scenes/konbini/props.ts
// 街边道具 Group "Props"：自动贩卖机（两台）、空调外机（屋顶两台、侧墙两台，风扇会转）、路灯、电线杆与电线、
// 立柱灯箱、反光镜、停车标志、垃圾箱、门口 A 字立牌；按歌变的自行车（菜篮车）和伞在 "SongProps" 里。
// 每件都是一个命名 Group，在本地坐标里搭好再摆到 layout 里的位置。

export interface KonbiniPlacement {
    position: THREE.Vector3;
    rotationY: number;
    width: number;
    height: number;
}

export interface KonbiniPropsParts {
    group: THREE.Group;
    /** 会转的风扇叶。 */
    fans: THREE.Object3D[];
    /** 贩卖机陈列窗里的样品罐（实例色，和商品一起换主题色）。 */
    productBatches: KonbiniProductBatch[];
    /** 招牌模块要贴字的面。 */
    pylonFaces: KonbiniPlacement[];
    aFrameFaces: KonbiniPlacement[];
    vendingPanels: KonbiniPlacement[];
    /** 路灯灯头（世界坐标）。 */
    streetLampHead: THREE.Vector3;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 自动贩卖机：机身、上部陈列窗（发光 + 样品罐）、按钮条、投币区、取物口。 */
const buildVendingMachine = (materials: MachiMaterials, name: string, cans: { x: number; y: number; z: number; color: number }[]) => {
    const { width: w, depth: d, height: h } = PROPS.vending;
    // 本地坐标：正面朝 +z，底面中心在原点。
    const parts: THREE.Object3D[] = [
        boxAt(materials.toon('vendingBody'), [w, h, d], [0, 0, 0], { radius: 0.05, name: 'Body' }),
        boxAt(materials.toon('darkMetal'), [w + 0.04, 0.08, d + 0.04], [0, 0, 0], { radius: 0.02, name: 'Plinth' }),
        boxAt(materials.toon('vendingAccent'), [w - 0.08, 0.06, 0.02], [0, h - 0.12, d / 2], { radius: 0.01, name: 'TopStripe' }),
        boxAt(materials.toon('darkMetal'), [w - 0.3, 0.2, 0.04], [-0.08, 0.16, d / 2 - 0.01], { radius: 0.02, name: 'Dispenser' }),
        boxAt(materials.toon('metal'), [0.18, 0.42, 0.03], [w / 2 - 0.17, 0.62, d / 2], { radius: 0.02, name: 'CoinPanel' }),
    ];
    const windowHeight = 0.86;
    const glow = mesh(new THREE.PlaneGeometry(w - 0.12, windowHeight), materials.glow('vendingGlow'), { name: 'Display', castShadow: false, receiveShadow: false });
    glow.position.set(0, h - 0.2 - windowHeight / 2, d / 2 - 0.05);
    parts.push(glow);
    // 按钮：两排小红灯。
    const buttons = new THREE.InstancedMesh(roundedBox(0.05, 0.022, 0.02, 0.006), materials.glow('redLamp'), 16);
    buttons.name = 'Buttons';
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 16; index += 1) {
        const row = Math.floor(index / 8);
        matrix.makeTranslation(-w / 2 + 0.1 + (index % 8) * ((w - 0.2) / 7), h - 0.2 - (row === 0 ? 0.42 : windowHeight + 0.05), d / 2 - 0.02);
        buttons.setMatrixAt(index, matrix);
    }
    parts.push(buttons);
    // 陈列窗里的样品罐：两层，每层 8 个。
    for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 8; column += 1) {
            cans.push({
                x: -w / 2 + 0.1 + column * ((w - 0.2) / 7),
                y: h - 0.2 - windowHeight + 0.08 + row * 0.44,
                z: d / 2 - 0.12,
                color: (column + row * 3) % 8,
            });
        }
    }
    return group(name, ...parts);
};

/** 菜篮自行车（日式 mamachari）：本地坐标沿 +x 是车头。 */
const buildBicycle = (materials: MachiMaterials, name: string) => {
    const frame = materials.toon('bike');
    const metal = materials.toon('metal');
    const rubber = materials.toon('rubber');
    const wheelRadius = 0.33;
    const parts: THREE.Object3D[] = [];
    const wheel = (x: number) => {
        const tire = mesh(new THREE.TorusGeometry(wheelRadius, 0.028, 6, 28), rubber, { name: 'Tire' });
        tire.position.set(x, wheelRadius + 0.03, 0);
        const rim = mesh(new THREE.TorusGeometry(wheelRadius - 0.03, 0.01, 4, 24), metal, { name: 'Rim' });
        rim.position.copy(tire.position);
        const hub = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8), metal, { name: 'Hub' });
        hub.rotation.x = Math.PI / 2;
        hub.position.copy(tire.position);
        parts.push(tire, rim, hub);
        // 辐条：几根细杆。
        for (let index = 0; index < 6; index += 1) {
            const angle = (index * Math.PI) / 6;
            const a = tire.position.clone().add(v(Math.cos(angle) * (wheelRadius - 0.03), Math.sin(angle) * (wheelRadius - 0.03), 0));
            const b = tire.position.clone().add(v(-Math.cos(angle) * (wheelRadius - 0.03), -Math.sin(angle) * (wheelRadius - 0.03), 0));
            parts.push(tubeBetween(metal, a, b, 0.004, { segments: 3, castShadow: false, name: 'Spoke' }));
        }
    };
    const rearX = -0.55;
    const frontX = 0.58;
    wheel(rearX);
    wheel(frontX);
    const axleY = wheelRadius + 0.03;
    const bottomBracket = v(-0.05, 0.3, 0);
    const seatTop = v(-0.25, 0.86, 0);
    const headTop = v(0.42, 0.95, 0);
    const headLow = v(0.48, 0.66, 0);
    // 女式低跨车架：下管弯得很低。
    parts.push(
        tubeBetween(frame, bottomBracket, seatTop, 0.022, { name: 'SeatTube' }),
        tubeBetween(frame, bottomBracket, headLow, 0.026, { name: 'DownTube' }),
        tubeBetween(frame, headLow, headTop, 0.024, { name: 'HeadTube' }),
        tubeBetween(frame, bottomBracket, v(rearX, axleY, 0.05), 0.014, { name: 'ChainStay' }),
        tubeBetween(frame, v(-0.22, 0.78, 0), v(rearX, axleY, 0.05), 0.014, { name: 'SeatStay' }),
        tubeBetween(metal, headLow, v(frontX, axleY, 0), 0.016, { name: 'Fork' }),
    );
    // 车座、车把、链罩、后货架、前车篮。
    parts.push(boxAt(rubber, [0.24, 0.06, 0.13], [seatTop.x - 0.02, seatTop.y, 0], { radius: 0.025, name: 'Saddle' }));
    parts.push(tubeBetween(metal, v(headTop.x - 0.12, headTop.y + 0.08, -0.26), v(headTop.x - 0.12, headTop.y + 0.08, 0.26), 0.014, { name: 'Handlebar' }));
    parts.push(tubeBetween(metal, headTop, v(headTop.x - 0.1, headTop.y + 0.08, 0), 0.016, { name: 'Stem' }));
    parts.push(boxAt(frame, [0.42, 0.09, 0.025], [-0.28, 0.28, 0.07], { radius: 0.02, name: 'ChainGuard' }));
    parts.push(boxAt(metal, [0.38, 0.02, 0.2], [rearX - 0.02, axleY + 0.36, 0], { radius: 0.006, name: 'Carrier' }));
    parts.push(boxAt(metal, [0.32, 0.22, 0.3], [frontX + 0.04, 0.82, 0], { radius: 0.02, name: 'Basket' }));
    // 支架：后轮旁边一根斜撑。
    parts.push(tubeBetween(metal, v(rearX + 0.1, axleY - 0.05, 0.04), v(rearX + 0.25, 0.01, 0.14), 0.01, { name: 'Kickstand' }));
    const bike = group(name, ...parts);
    // 用支架撑着，略微侧倾。
    bike.rotation.x = -4 * DEG;
    return bike;
};

/** 空调外机：机身、圆形出风格栅、会转的风扇叶、冷媒管。正面朝 +z。 */
const buildAcUnit = (materials: MachiMaterials, name: string, fans: THREE.Object3D[]) => {
    const body = materials.toon('acUnit');
    const dark = materials.toon('darkMetal');
    const parts: THREE.Object3D[] = [
        boxAt(body, [0.82, 0.62, 0.3], [0, 0.04, 0], { radius: 0.04, name: 'Body' }),
        boxAt(dark, [0.86, 0.04, 0.34], [0, 0, 0], { radius: 0.01, name: 'Feet' }),
    ];
    const grille = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 20), dark, { name: 'Grille' });
    grille.rotation.x = Math.PI / 2;
    grille.position.set(-0.12, 0.36, 0.15);
    parts.push(grille);
    const blades: THREE.Object3D[] = [];
    for (let index = 0; index < 3; index += 1) {
        const blade = mesh(roundedBox(0.18, 0.07, 0.01, 0.004), materials.toon('metal'), { name: 'Blade', castShadow: false });
        blade.position.set(Math.cos((index * 2 * Math.PI) / 3) * 0.09, Math.sin((index * 2 * Math.PI) / 3) * 0.09, 0);
        blade.rotation.z = (index * 2 * Math.PI) / 3;
        blades.push(blade);
    }
    const fan = group('Fan', ...blades);
    fan.position.set(-0.12, 0.36, 0.165);
    fan.userData.dynamic = true;
    fans.push(fan);
    parts.push(fan);
    parts.push(boxAt(dark, [0.04, 0.3, 0.04], [0.32, 0.1, -0.14], { radius: 0.01, name: 'Pipe' }));
    return group(name, ...parts);
};

/** 路灯：锥形灯杆、伸出的灯臂、灯头（底面发光）。 */
const buildStreetLamp = (materials: MachiMaterials) => {
    const { x, z, height, arm } = PROPS.streetLamp;
    const metal = materials.toon('metal');
    const parts: THREE.Object3D[] = [
        cylinderAt(metal, 0.085, height, [0, LEVEL.lot, 0], { radiusTop: 0.055, segments: 10, name: 'Pole' }),
        cylinderAt(materials.toon('darkMetal'), 0.12, 0.3, [0, LEVEL.lot, 0], { segments: 10, name: 'Foot' }),
        tubeBetween(metal, v(0, LEVEL.lot + height - 0.15, 0), v(-arm * 0.55, LEVEL.lot + height + 0.12, 0), 0.04, { name: 'Arm' }),
        tubeBetween(metal, v(-arm * 0.55, LEVEL.lot + height + 0.12, 0), v(-arm, LEVEL.lot + height + 0.08, 0), 0.04, { name: 'Arm' }),
        boxAt(materials.toon('darkMetal'), [0.56, 0.1, 0.24], [-arm - 0.12, LEVEL.lot + height, 0], { radius: 0.04, name: 'Head' }),
    ];
    const lens = mesh(new THREE.PlaneGeometry(0.46, 0.16), materials.glow('lampHead'), { name: 'Lens', castShadow: false, receiveShadow: false });
    lens.rotation.x = Math.PI / 2;
    lens.position.set(-arm - 0.12, LEVEL.lot + height - 0.003, 0);
    parts.push(lens);
    const lamp = group('StreetLamp', ...parts);
    lamp.position.set(x, 0, z);
    return { group: lamp, head: v(x - arm - 0.12, LEVEL.lot + height - 0.02, z) };
};

/** 电线杆：混凝土杆、两层横担与瓷瓶、变压器、底部黄黑护套；电线顺着左边沿伸出底座。 */
const buildUtilityPole = (materials: MachiMaterials) => {
    const { x, z, height } = PROPS.utilityPole;
    const top = LEVEL.lot + height;
    const parts: THREE.Object3D[] = [
        cylinderAt(materials.toon('pole'), 0.15, height, [x, LEVEL.lot, z], { radiusTop: 0.11, segments: 14, name: 'Pole' }),
        cylinderAt(materials.toon('caution'), 0.165, 1.6, [x, LEVEL.lot, z], { segments: 14, name: 'Guard' }),
        cylinderAt(materials.toon('acUnit'), 0.2, 0.62, [x + 0.32, top - 2.2, z], { segments: 12, name: 'Transformer' }),
        tubeBetween(materials.toon('darkMetal'), v(x, top - 1.9, z), v(x + 0.32, top - 1.9, z), 0.03, { name: 'TransformerBracket' }),
    ];
    const insulators: THREE.Vector3[] = [];
    const wireEnds: THREE.Vector3[] = [];
    [top - 0.7, top - 0.25].forEach((y, level) => {
        const span = level === 0 ? 0.9 : 1.2;
        parts.push(boxSpan(materials.toon('darkMetal'), x - span / 2, x + span / 2, y - 0.05, y + 0.05, z - 0.06, z + 0.06, { radius: 0.015, name: 'Crossarm' }));
        [-span / 2 + 0.08, 0, span / 2 - 0.08].forEach(offset => {
            if (offset === 0 && level === 1) return;
            insulators.push(v(x + offset, y + 0.05, z));
        });
    });
    insulators.forEach(point => {
        parts.push(cylinderAt(materials.toon('white'), 0.04, 0.1, [point.x, point.y, point.z], { radiusTop: 0.025, segments: 8, name: 'Insulator' }));
        wireEnds.push(point.clone().setY(point.y + 0.09));
    });
    // 电线：往后沿左边出底座，往前跨过前路到对面边上；另一根接到店的前左角。
    const wire = materials.toon('wire');
    wireEnds.forEach((end, index) => {
        const backEnd = v(end.x + (index - 2) * 0.03, end.y - 0.3, -BASE.half);
        const frontEnd = v(end.x + (index - 2) * 0.03, end.y - 0.2, BASE.half);
        parts.push(sagWire(wire, end, backEnd, 0.55 + index * 0.04));
        parts.push(sagWire(wire, end, frontEnd, 0.35 + index * 0.03));
    });
    parts.push(sagWire(wire, v(x + 0.1, top - 2.6, z), v(STORE.x0 + 0.1, STORE.parapetTop - 0.1, STORE.z1 - 0.1), 0.35, 0.01));
    // 杆上的地址牌。
    parts.push(boxAt(materials.toon('brand2'), [0.03, 0.42, 0.14], [x + 0.15, LEVEL.lot + 1.9, z], { radius: 0.01, name: 'AddressPlate' }));
    return group('UtilityPole', ...parts);
};

/** 立柱灯箱：两根立柱托着一个双面灯箱（字面另挂）。 */
const buildPylon = (materials: MachiMaterials) => {
    const { x, z, height } = PROPS.pylon;
    const box = { w: 1.35, h: 1.25, d: 0.32 };
    const rotationY = 45 * DEG;
    const parts: THREE.Object3D[] = [
        boxAt(materials.toon('darkMetal'), [0.12, height - box.h, 0.12], [-0.42, LEVEL.lot, 0], { radius: 0.02, name: 'Post' }),
        boxAt(materials.toon('darkMetal'), [0.12, height - box.h, 0.12], [0.42, LEVEL.lot, 0], { radius: 0.02, name: 'Post' }),
        boxAt(materials.toon('signBase'), [box.w, box.h, box.d], [0, LEVEL.lot + height - box.h, 0], { radius: 0.05, name: 'Box' }),
        boxAt(materials.toon('brand0'), [box.w + 0.04, 0.1, box.d + 0.04], [0, LEVEL.lot + height - 0.04, 0], { radius: 0.03, name: 'Cap' }),
        boxAt(materials.toon('brand2'), [box.w + 0.02, 0.07, box.d + 0.02], [0, LEVEL.lot + height - box.h, 0], { radius: 0.02, name: 'Base' }),
        boxAt(materials.toon('concrete'), [1.0, 0.18, 0.4], [0, LEVEL.lot, 0], { radius: 0.03, name: 'Footing' }),
    ];
    const pylon = group('Pylon', ...parts);
    pylon.position.set(x, 0, z);
    pylon.rotation.y = rotationY;
    const center = v(x, LEVEL.lot + height - box.h / 2 - 0.02, z);
    const normal = v(Math.sin(rotationY), 0, Math.cos(rotationY));
    const faces: KonbiniPlacement[] = [0, Math.PI].map(turn => ({
        position: center.clone().addScaledVector(normal, (turn === 0 ? 1 : -1) * (box.d / 2 + 0.006)),
        rotationY: rotationY + turn,
        width: box.w - 0.12,
        height: box.h - 0.22,
    }));
    return { group: pylon, faces };
};

/** 路口的反光镜：橙色立杆、圆镜。 */
const buildCurveMirror = (materials: MachiMaterials) => {
    const { x, z, height } = PROPS.curveMirror;
    const pole = materials.toon('mirrorPole');
    const parts: THREE.Object3D[] = [
        cylinderAt(pole, 0.035, height, [0, LEVEL.lot, 0], { segments: 8, name: 'Pole' }),
        tubeBetween(pole, v(0, LEVEL.lot + height - 0.1, 0), v(0.2, LEVEL.lot + height - 0.1, -0.14), 0.025, { name: 'Bracket' }),
    ];
    const rim = mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 24), pole, { name: 'Rim' });
    const glass = mesh(new THREE.CircleGeometry(0.29, 24), materials.toon('metal'), { name: 'Mirror', castShadow: false });
    [rim, glass].forEach(part => {
        part.position.set(0.26, LEVEL.lot + height - 0.1, -0.18);
        part.rotation.y = 125 * DEG;
        part.rotateX(-12 * DEG);
        parts.push(part);
    });
    const mirror = group('CurveMirror', ...parts);
    mirror.position.set(x, 0, z);
    return mirror;
};

/** 停车标志：倒三角红牌、白边。 */
const buildStopSign = (materials: MachiMaterials) => {
    const { x, z, height } = PROPS.stopSign;
    const shape = new THREE.Shape();
    const r = 0.36;
    for (let index = 0; index < 3; index += 1) {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 3;
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r;
        if (index === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
    }
    shape.closePath();
    const plate = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.01, bevelSegments: 1 });
    const parts: THREE.Object3D[] = [
        cylinderAt(materials.toon('metal'), 0.03, height, [0, LEVEL.lot, 0], { segments: 8, name: 'Pole' }),
    ];
    const back = mesh(plate, materials.toon('white'), { name: 'Rim' });
    back.position.set(0, LEVEL.lot + height - 0.15, 0.03);
    const face = mesh(new THREE.ShapeGeometry(shape), materials.toon('stopRed'), { name: 'Face' });
    face.scale.setScalar(0.86);
    face.position.set(0, LEVEL.lot + height - 0.15 - 0.012, 0.08);
    parts.push(back, face);
    const sign = group('StopSign', ...parts);
    sign.position.set(x, 0, z);
    sign.rotation.y = 60 * DEG;
    return sign;
};

/** 店前的分类垃圾箱：三个，盖子是招牌色。 */
const buildTrash = (materials: MachiMaterials) => {
    const { x, z } = PROPS.trash;
    const lids = ['brand0', 'brand2', 'trim'] as const;
    const parts: THREE.Object3D[] = lids.flatMap((lid, index) => [
        boxAt(materials.toon('acUnit'), [0.34, 0.82, 0.36], [(index - 1) * 0.37, LEVEL.lot, 0], { radius: 0.03, name: 'Bin' }),
        boxAt(materials.toon(lid), [0.36, 0.08, 0.38], [(index - 1) * 0.37, LEVEL.lot + 0.82, 0], { radius: 0.03, name: 'Lid' }),
    ]);
    const trash = group('TrashBins', ...parts);
    trash.position.set(x, 0, z);
    return trash;
};

/** 伞架（几把收着的伞）与地上撑开晾着的一把伞。 */
const buildUmbrellas = (materials: MachiMaterials, variation: KonbiniVariation) => {
    const { x, z } = PROPS.umbrellaStand;
    const umbrella = materials.toon('umbrella');
    const parts: THREE.Object3D[] = [
        boxAt(materials.toon('metal'), [0.36, 0.5, 0.22], [0, LEVEL.lot, 0], { radius: 0.02, name: 'Stand' }),
    ];
    if (variation.umbrellaInStand) {
        [-0.09, 0.04, 0.11].forEach((offset, index) => {
            const closed = mesh(new THREE.ConeGeometry(0.05, 0.72, 8), index === 1 ? materials.toon('trim') : umbrella, { name: 'Closed' });
            closed.position.set(offset, LEVEL.lot + 0.4, (index - 1) * 0.04);
            closed.rotation.z = (index - 1) * 0.12;
            closed.rotation.x = Math.PI;
            parts.push(closed);
        });
    }
    const stand = group('UmbrellaStand', ...parts);
    stand.position.set(x, 0, z);
    const result: THREE.Object3D[] = [stand];
    if (variation.openUmbrella) {
        const canopy = mesh(new THREE.ConeGeometry(0.48, 0.28, 8, 1, true), umbrella, { name: 'Canopy' });
        canopy.material = umbrella;
        const shaft = tubeBetween(materials.toon('darkMetal'), v(0, 0.14, 0), v(0, -0.45, 0), 0.01, { name: 'Shaft' });
        const open = group('OpenUmbrella', canopy, shaft);
        open.position.set(x - 0.75, LEVEL.lot + 0.32, z + 0.55);
        open.rotation.set(0.9, 0.6, 0.4);
        result.push(open);
    }
    return result;
};

/** 门口的 A 字立牌：两块斜靠的板，正面贴主题名。 */
const buildAFrame = (materials: MachiMaterials) => {
    const { x, z } = PROPS.aFrame;
    const lean = 12 * DEG;
    const board = { w: 0.56, h: 0.82 };
    const rotationY = 30 * DEG;
    const parts: THREE.Object3D[] = [];
    [1, -1].forEach(side => {
        const panel = mesh(roundedBox(board.w, board.h, 0.03, 0.012), materials.toon('darkMetal'), { name: 'Panel' });
        panel.position.set(0, LEVEL.lot + Math.cos(lean) * board.h / 2, side * Math.sin(lean) * board.h / 2);
        panel.rotation.x = side * -lean;
        parts.push(panel);
    });
    const frame = group('AFrame', ...parts);
    frame.position.set(x, 0, z);
    frame.rotation.y = rotationY;
    const normal = v(Math.sin(rotationY), 0, Math.cos(rotationY));
    const faceCenter = v(x, LEVEL.lot + Math.cos(lean) * board.h / 2, z).addScaledVector(normal, Math.sin(lean) * board.h / 2 + 0.02);
    return {
        group: frame,
        faces: [{ position: faceCenter, rotationY, width: board.w - 0.06, height: board.h - 0.08, lean } as KonbiniPlacement & { lean: number }],
    };
};

/**
 * 按歌变的道具 Group "SongProps"：自行车（一到两辆、停在哪、颜色走调色板）、伞架里的伞、地上晾着的伞。
 * 换歌时整组换掉重建，其余道具不动。
 */
export const buildKonbiniSongProps = (materials: MachiMaterials, variation: KonbiniVariation) => {
    const parts: THREE.Object3D[] = [];
    const firstSlot = PROPS.bikeSlots[variation.bikeSlot];
    const bike = buildBicycle(materials, 'Bicycle0');
    bike.position.set(firstSlot.x, LEVEL.lot, firstSlot.z);
    bike.rotation.y = Math.PI + variation.bikeYaw;
    parts.push(bike);
    if (variation.secondBike) {
        const otherSlot = PROPS.bikeSlots[variation.bikeSlot === 0 ? 1 : 0];
        const second = buildBicycle(materials, 'Bicycle1');
        second.position.set(otherSlot.x, LEVEL.lot, otherSlot.z + 0.05);
        second.rotation.y = Math.PI - variation.bikeYaw * 0.7;
        parts.push(second);
    }
    parts.push(...buildUmbrellas(materials, variation));
    return group('SongProps', ...parts);
};

export const buildKonbiniProps = (materials: MachiMaterials): KonbiniPropsParts => {
    const fans: THREE.Object3D[] = [];
    const cans: { x: number; y: number; z: number; color: number }[] = [];
    const vendingPanels: KonbiniPlacement[] = [];
    const machines = PROPS.vending.z.map((z, index) => {
        const localCans: typeof cans = [];
        const machine = buildVendingMachine(materials, `Vending${index}`, localCans);
        machine.position.set(PROPS.vending.x + PROPS.vending.depth / 2 + 0.02, LEVEL.lot, z);
        machine.rotation.y = Math.PI / 2;
        localCans.forEach(can => {
            // 本地 (x, z) 转到世界：绕 y 转 90°。
            cans.push({ x: machine.position.x + can.z, y: LEVEL.lot + can.y, z: z - can.x, color: can.color });
        });
        vendingPanels.push({
            position: v(machine.position.x + PROPS.vending.depth / 2 + 0.004, LEVEL.lot + PROPS.vending.height - 0.2 - 0.43, z),
            rotationY: Math.PI / 2,
            width: PROPS.vending.width - 0.12,
            height: 0.86,
        });
        return machine;
    });
    const canBatch = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 8), materials.product, cans.length);
    canBatch.name = 'SampleCans';
    canBatch.castShadow = false;
    const colorIndex = new Uint8Array(cans.length);
    const shade = new Float32Array(cans.length);
    const matrix = new THREE.Matrix4();
    cans.forEach((can, index) => {
        matrix.makeScale(0.07, 0.14, 0.07);
        matrix.setPosition(can.x, can.y + 0.07, can.z);
        canBatch.setMatrixAt(index, matrix);
        canBatch.setColorAt(index, new THREE.Color(1, 1, 1));
        colorIndex[index] = can.color;
        shade[index] = 1.1;
    });

    const acUnits = [
        ...PROPS.roofAc.map((at, index) => {
            const unit = buildAcUnit(materials, `RoofAc${index}`, fans);
            unit.position.set(at.x, STORE.roofTop, at.z);
            unit.rotation.y = index === 0 ? 0 : Math.PI / 2;
            return unit;
        }),
        ...PROPS.groundAc.z.map((z, index) => {
            const unit = buildAcUnit(materials, `GroundAc${index}`, fans);
            unit.position.set(PROPS.groundAc.x, LEVEL.lot, z);
            unit.rotation.y = -Math.PI / 2;
            return unit;
        }),
    ];

    const lamp = buildStreetLamp(materials);
    const pylon = buildPylon(materials);
    const aFrame = buildAFrame(materials);
    const props = group(
        'Props',
        ...machines,
        canBatch,
        ...acUnits,
        lamp.group,
        buildUtilityPole(materials),
        pylon.group,
        buildCurveMirror(materials),
        buildStopSign(materials),
        buildTrash(materials),
        aFrame.group,
    );
    return {
        group: props,
        fans,
        productBatches: [{ mesh: canBatch, colorIndex, shade }],
        pylonFaces: pylon.faces,
        aFrameFaces: aFrame.faces,
        vendingPanels,
        streetLampHead: lamp.head,
    };
};
