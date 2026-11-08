import * as THREE from 'three';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import { MACHI_REFLECT_LAYER } from '../../engine/fx/reflection';
import { boxSpan, cylinderAt, group, mesh } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { BAR, BAR_SIGN, LEVEL, SCREEN, TICKER } from './layout';

// src/components/visualizer/machi/scenes/kowloon/bar.ts
// 酒吧（B1 的一楼）：深色地砖、玻璃门面（竖框、踢脚、右边一扇玻璃门）、店里一条吧台（台面下一道霓虹灯带）、
// 五张高脚凳、后墙一整面背光的酒架（瓶子是 InstancedMesh）、三盏吊灯、角落一台点唱机（拱顶的灯随音乐一明一暗）。
// 门头是霓虹店招的灯箱（字面由 kowloonSigns 挂上），再往上是跑马灯条与歌词大屏的外框。

export interface KowloonBarParts {
    group: THREE.Group;
    bottles: THREE.InstancedMesh;
}

/** 酒瓶：琥珀、深绿、透明、蓝、红、金。 */
const BOTTLE_COLORS = ['#c98a3a', '#2f6b45', '#d9e4e8', '#3d6fb6', '#a8323a', '#e0b84f', '#7a4a2a'];

export const buildKowloonBar = (materials: MachiMaterials, seed: string | number): KowloonBarParts => {
    const random = createVisualizerRng(`kowloon:bar:${seed}`);
    const { x0, x1, glass: glassZ, back, ceiling } = BAR;
    const frame = materials.toon('barFrame');
    const parts: THREE.Object3D[] = [
        // 地砖、天花、两侧内墙、后墙。
        boxSpan(materials.toon('barFloor'), x0, x1, 0, LEVEL.floor, back, glassZ, { radius: 0.005, name: 'Floor' }),
        boxSpan(materials.toon('barWall'), x0, x1, ceiling - 0.05, ceiling, back, glassZ, { radius: 0, name: 'Ceiling' }),
        boxSpan(materials.toon('barWall'), x0, x0 + 0.04, LEVEL.floor, ceiling, back, glassZ, { radius: 0, name: 'Wall' }),
        boxSpan(materials.toon('barWall'), x1 - 0.04, x1, LEVEL.floor, ceiling, back, glassZ, { radius: 0, name: 'Wall' }),
        boxSpan(materials.toon('barWall'), x0, x1, LEVEL.floor, ceiling, back, back + 0.04, { radius: 0, name: 'Wall' }),
        // 门面：两侧墙垛、玻璃下的踢脚、玻璃上沿的横梁。墙垛包住楼的墙角，前面和外侧都比楼面凸出一点，
        // 里侧伸进门洞一点：跟楼的墙面重合的话两种颜色会互相闪。
        boxSpan(frame, x0 - 0.22, x0 + 0.01, 0, ceiling, glassZ - 0.02, BAR.front + 0.03, { radius: 0.01, name: 'Pier' }),
        boxSpan(frame, x1 - 0.01, x1 + 0.22, 0, ceiling, glassZ - 0.02, BAR.front + 0.03, { radius: 0.01, name: 'Pier' }),
        boxSpan(frame, x0, BAR.door[0], 0, 0.36, glassZ - 0.06, glassZ + 0.04, { radius: 0.01, name: 'Kick' }),
        boxSpan(frame, x0, x1, 2.32, 2.4, glassZ - 0.06, glassZ + 0.04, { radius: 0.01, name: 'Head' }),
        // 门口一级台阶。
        boxSpan(materials.toon('slab'), BAR.door[0] - 0.1, BAR.door[1] + 0.1, 0, LEVEL.floor, glassZ, BAR.front + 0.3, { radius: 0.01, name: 'Step' }),
    ];
    // 玻璃：门左边的橱窗，竖框约每 1.1m 一根；门是一扇带框的玻璃门。
    const glass = materials.glass;
    const pane = (a: number, b: number, bottom: number, top: number, name: string) => {
        const result = mesh(new THREE.PlaneGeometry(b - a, top - bottom), glass, { name, castShadow: false, receiveShadow: false });
        result.position.set((a + b) / 2, (bottom + top) / 2, glassZ);
        result.renderOrder = 2;
        return result;
    };
    parts.push(pane(x0, BAR.door[0], 0.36, 2.32, 'Glass/window'));
    const mullions = Math.max(1, Math.round((BAR.door[0] - x0) / 1.1));
    for (let index = 0; index <= mullions; index += 1) {
        const x = x0 + ((BAR.door[0] - x0) * index) / mullions;
        parts.push(boxSpan(frame, x - 0.03, x + 0.03, 0.36, 2.32, glassZ - 0.04, glassZ + 0.03, { radius: 0.01, name: 'Mullion' }));
    }
    const [d0, d1] = BAR.door;
    parts.push(
        boxSpan(frame, d0, d0 + 0.07, LEVEL.floor, 2.32, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Door' }),
        boxSpan(frame, d1 - 0.07, d1, LEVEL.floor, 2.32, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Door' }),
        boxSpan(frame, d0, d1, LEVEL.floor, LEVEL.floor + 0.12, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Door' }),
        boxSpan(materials.toon('chrome'), d1 - 0.2, d1 - 0.16, 0.9, 1.4, glassZ + 0.03, glassZ + 0.07, { radius: 0.01, name: 'Door' }),
        pane(d0 + 0.07, d1 - 0.07, LEVEL.floor + 0.12, 2.32, 'Glass/door'),
        boxSpan(frame, x1 - 0.2, x1, 0.36, 2.32, glassZ - 0.04, glassZ + 0.04, { radius: 0.01, name: 'Pier' }),
    );
    // 后墙的酒架：一整面背光（发光板），三层隔板，瓶子摆在隔板上。
    const shelfX0 = x0 + 0.35;
    const shelfX1 = BAR.counter.x1 + 0.15;
    parts.push(boxSpan(materials.glow('barBacklight'), shelfX0, shelfX1, 1.0, 2.55, back + 0.04, back + 0.06, { radius: 0, name: 'Backlight' }));
    const shelfLevels = [1.05, 1.55, 2.05];
    shelfLevels.forEach(level => parts.push(boxSpan(materials.toon('counterTop'), shelfX0, shelfX1, level - 0.03, level, back + 0.06, back + 0.3, { radius: 0.005, name: 'Shelf' })));
    const bottles: { x: number; y: number; z: number; h: number; color: string }[] = [];
    shelfLevels.forEach(level => {
        let x = shelfX0 + 0.08;
        while (x < shelfX1 - 0.08) {
            if (random() > 0.12) bottles.push({ x, y: level, z: back + 0.17 + (random() - 0.5) * 0.06, h: 0.2 + random() * 0.14, color: BOTTLE_COLORS[Math.floor(random() * BOTTLE_COLORS.length)]! });
            x += 0.1 + random() * 0.05;
        }
    });
    const bottleGeometry = new THREE.CylinderGeometry(0.032, 0.04, 1, 8).translate(0, 0.5, 0);
    const bottleMesh = new THREE.InstancedMesh(bottleGeometry, materials.product, bottles.length);
    bottleMesh.name = 'Bar/bottles';
    bottleMesh.castShadow = false;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    bottles.forEach((bottle, index) => {
        matrix.makeScale(1, bottle.h, 1).setPosition(bottle.x, bottle.y, bottle.z);
        bottleMesh.setMatrixAt(index, matrix);
        bottleMesh.setColorAt(index, color.set(bottle.color));
    });
    // 吧台：台身、台面（往外挑一点）、台面下一道霓虹灯带、脚踏杆。
    const counter = BAR.counter;
    parts.push(
        boxSpan(materials.toon('counter'), counter.x0, counter.x1, LEVEL.floor, counter.height - 0.05, counter.z0, counter.z1, { radius: 0.02, name: 'Counter' }),
        boxSpan(materials.toon('counterTop'), counter.x0 - 0.06, counter.x1 + 0.06, counter.height - 0.05, counter.height, counter.z0 - 0.04, counter.z1 + 0.1, { radius: 0.015, name: 'CounterTop' }),
        boxSpan(materials.glow('barStrip'), counter.x0, counter.x1, counter.height - 0.11, counter.height - 0.08, counter.z1 + 0.005, counter.z1 + 0.03, { radius: 0, name: 'Strip' }),
        boxSpan(materials.toon('chrome'), counter.x0 + 0.05, counter.x1 - 0.05, 0.22, 0.25, counter.z1 + 0.08, counter.z1 + 0.11, { radius: 0.01, name: 'FootRail' }),
    );
    // 高脚凳：红座、镀铬的杆与底盘。
    const stools = 5;
    for (let index = 0; index < stools; index += 1) {
        const x = counter.x0 + 0.3 + ((counter.x1 - counter.x0 - 0.6) * index) / (stools - 1);
        const z = counter.z1 + 0.42;
        parts.push(
            cylinderAt(materials.toon('chrome'), 0.15, 0.03, [x, LEVEL.floor, z], { name: 'Stool', segments: 12 }),
            cylinderAt(materials.toon('chrome'), 0.025, 0.7, [x, LEVEL.floor, z], { name: 'Stool', segments: 6 }),
            cylinderAt(materials.toon('stool'), 0.17, 0.08, [x, 0.74, z], { name: 'Stool', segments: 14 }),
        );
    }
    // 吊灯：天花垂下的线与一颗发光的灯罩。
    [0.25, 0.5, 0.75].forEach(t => {
        const x = counter.x0 + (counter.x1 - counter.x0) * t;
        const z = (counter.z0 + counter.z1) / 2 + 0.25;
        parts.push(cylinderAt(materials.toon('wire'), 0.008, ceiling - 2.25, [x, 2.25, z], { name: 'Pendant', segments: 4 }));
        const shade = mesh(new THREE.SphereGeometry(0.09, 12, 8), materials.glow('pendant'), { name: 'Pendant', castShadow: false });
        shade.position.set(x, 2.2, z);
        parts.push(shade);
    });
    // 点唱机：右后角，机身、拱顶的灯（随音乐明暗）、前面一块深色的面板。
    const jx = (counter.x1 + x1) / 2 + 0.15;
    const jz = back + 0.32;
    parts.push(
        boxSpan(materials.toon('jukebox'), jx - 0.32, jx + 0.32, LEVEL.floor, 1.05, jz - 0.22, jz + 0.22, { radius: 0.04, name: 'Jukebox' }),
        boxSpan(materials.toon('windowDark'), jx - 0.22, jx + 0.22, 0.55, 0.95, jz + 0.2, jz + 0.235, { radius: 0.01, name: 'Jukebox' }),
    );
    const arch = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.44, 16, 1, false, -Math.PI / 2, Math.PI), materials.glow('jukebox'), { name: 'Jukebox/arch', castShadow: false });
    arch.rotation.x = Math.PI / 2;
    arch.position.set(jx, 1.05, jz);
    parts.push(arch);
    // 门面上沿以上：店招的灯箱、跑马灯条的底板、歌词大屏的外框与两根支架。
    const signBox = materials.toon('signBox');
    parts.push(
        boxSpan(signBox, BAR_SIGN.x - BAR_SIGN.width / 2 - 0.08, BAR_SIGN.x + BAR_SIGN.width / 2 + 0.08, BAR_SIGN.y - BAR_SIGN.height / 2 - 0.06, BAR_SIGN.y + BAR_SIGN.height / 2 + 0.06, BAR.front, BAR_SIGN.z - 0.005, { radius: 0.02, name: 'SignBox' }),
        boxSpan(signBox, TICKER.x - TICKER.width / 2 - 0.05, TICKER.x + TICKER.width / 2 + 0.05, TICKER.y - TICKER.height / 2 - 0.04, TICKER.y + TICKER.height / 2 + 0.04, BAR.front, TICKER.z - 0.005, { radius: 0.01, name: 'TickerBox' }),
        boxSpan(materials.toon('screenFrame'), SCREEN.x - SCREEN.width / 2 - 0.1, SCREEN.x + SCREEN.width / 2 + 0.1, SCREEN.y - SCREEN.height / 2 - 0.08, SCREEN.y + SCREEN.height / 2 + 0.08, BAR.front, SCREEN.z - 0.005, { radius: 0.03, name: 'ScreenFrame' }),
    );
    // 只在倒影里出现的橱窗光（店里亮着的那一片）。
    const standIn = mesh(new THREE.PlaneGeometry(BAR.door[1] - x0 - 0.2, 1.8), materials.glow('barWindow'), { name: 'ReflectionWindow', castShadow: false, receiveShadow: false });
    standIn.position.set((x0 + BAR.door[1]) / 2, 1.3, glassZ - 0.15);
    standIn.layers.set(MACHI_REFLECT_LAYER);
    parts.push(standIn);
    return { group: group('Bar', ...parts, bottleMesh), bottles: bottleMesh };
};
