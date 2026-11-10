import * as THREE from 'three';
import { createVisualizerRng } from '../../../visualizerSeedHash';
import type { MachiDrip } from '../../engine/fx/weather';
import { boxAt, boxSpan, cylinderAt, group, mesh, roundedBox } from '../../engine/geometry/shapes';
import type { MachiMaterials } from '../../engine/materials';
import { BLOCKS, FLOORS, LEVEL, type KowloonBlock } from './layout';

// src/components/visualizer/machi/scenes/kowloon/blocks.ts
// 城寨楼：每栋一个盒子，朝外的三面（+z、+x、-x）按层按列铺窗。窗格只铺在露在外面的地方（格子前一点的点落在别的楼里
// 就跳过），也避开歌词屏、招牌。每扇窗随机配一样东西：铁窗笼、窗下的冷气机（下雨时滴水）、伸出去的晾衫竹、
// 封出去的加建小间；每层一道楼板线，两列窗之间几根水管。伸出墙外的东西与水管各占一块地方，后放的让开先放的。
// 夜里按 seed 亮一部分窗（暖黄、日光灯白、偏绿、偏粉），亮窗和暗窗各一个 InstancedMesh，晾的衫一个 InstancedMesh
// （实例色）。楼顶：女儿墙、水箱、天线、小屋、锅盖。

export interface KowloonWindowBatch {
    mesh: THREE.InstancedMesh;
    material: THREE.MeshBasicMaterial;
}

export interface KowloonBlockParts {
    group: THREE.Group;
    litWindows: KowloonWindowBatch;
    darkWindows: THREE.InstancedMesh;
    clothes: THREE.InstancedMesh;
    /** 冷气机滴水（下雨时）。 */
    drips: MachiDrip[];
}

/** 亮窗的颜色：暖黄的灯泡、日光灯白、偏绿的日光灯、粉色的灯（赛博朋克的城寨）。 */
const WINDOW_LIGHTS = ['#ffc47a', '#ffd39a', '#cfe2f5', '#b4f0cf', '#ff8fd0', '#8fc8f5'];
const WINDOW_WEIGHTS = [0.3, 0.16, 0.22, 0.12, 0.1, 0.1];

/** 晾的衫：白、浅蓝、红、黄、粉、藏青、灰。 */
const CLOTHES = ['#f1efe8', '#a9c8e8', '#d0463c', '#e8c24a', '#f0a3c0', '#2c3d63', '#9a9fa6', '#6fb08a'];

interface Face {
    block: KowloonBlock;
    origin: THREE.Vector3;
    along: THREE.Vector3;
    normal: THREE.Vector3;
    width: number;
    rotationY: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** 一栋楼朝外的三面：前（+z）、右（+x）、左（-x）。 */
const facesOf = (block: KowloonBlock): Face[] => [
    { block, origin: new THREE.Vector3(block.x0, 0, block.z1), along: new THREE.Vector3(1, 0, 0), normal: new THREE.Vector3(0, 0, 1), width: block.x1 - block.x0, rotationY: 0 },
    { block, origin: new THREE.Vector3(block.x1, 0, block.z1), along: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(1, 0, 0), width: block.z1 - block.z0, rotationY: Math.PI / 2 },
    { block, origin: new THREE.Vector3(block.x0, 0, block.z0), along: new THREE.Vector3(0, 0, 1), normal: new THREE.Vector3(-1, 0, 0), width: block.z1 - block.z0, rotationY: -Math.PI / 2 },
];

/** 点在哪栋楼里面（eps 往里收一点，贴着墙面的点不算）。 */
const insideAnyBlock = (point: THREE.Vector3, eps = 0.01) => BLOCKS.some(block => (
    point.x > block.x0 + eps && point.x < block.x1 - eps && point.z > block.z0 + eps && point.z < block.z1 - eps && point.y < block.height - eps
));

const insideAny = (point: THREE.Vector3, boxes: readonly THREE.Box3[]) => boxes.some(box => box.containsPoint(point));

/** 墙面上 (s, y) 处、往外 out 米的点。 */
const facePoint = (face: Face, s: number, y: number, out = 0) => face.origin.clone()
    .addScaledVector(face.along, s)
    .addScaledVector(UP, y)
    .addScaledVector(face.normal, out);

/** 墙面上一块地方的包围盒：沿墙 s0..s1、高 y0..y1、往外 out0..out1。 */
const faceBounds = (face: Face, s0: number, s1: number, y0: number, y1: number, out0: number, out1: number) => (
    new THREE.Box3().setFromPoints([facePoint(face, s0, y0, out0), facePoint(face, s1, y1, out1)])
);

const hitsAny = (box: THREE.Box3, boxes: readonly THREE.Box3[]) => boxes.some(other => other.intersectsBox(box));

/** 贴着墙面的一个盒子：宽沿墙、高、厚沿法线；中心在墙外 out 米。 */
const faceBox = (material: THREE.Material, face: Face, s: number, y: number, size: [number, number, number], out: number, name: string) => {
    const result = mesh(roundedBox(size[0], size[1], size[2], 0), material, { name });
    result.position.copy(facePoint(face, s, y + size[1] / 2, out));
    result.rotation.y = face.rotationY;
    return result;
};

const pickWeighted = (random: () => number, weights: readonly number[]) => {
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < weights.length; index += 1) {
        roll -= weights[index]!;
        if (roll <= 0) return index;
    }
    return weights.length - 1;
};

interface InstanceSlot {
    position: THREE.Vector3;
    rotationY: number;
    scale: THREE.Vector3;
    color?: string;
}

const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, slots: InstanceSlot[], name: string, castShadow = false) => {
    const result = new THREE.InstancedMesh(geometry, material, Math.max(1, slots.length));
    result.name = name;
    result.count = slots.length;
    result.castShadow = castShadow;
    result.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();
    slots.forEach((slot, index) => {
        quaternion.setFromAxisAngle(UP, slot.rotationY);
        matrix.compose(slot.position, quaternion, slot.scale);
        result.setMatrixAt(index, matrix);
        if (slot.color) result.setColorAt(index, color.set(slot.color));
    });
    result.instanceMatrix.needsUpdate = true;
    if (result.instanceColor) result.instanceColor.needsUpdate = true;
    return result;
};

/**
 * 所有的楼。avoid 是不铺窗的地方（歌词屏、广告架）；signs 是招牌占的地方：冷气机、铁笼、晾衫竹、水管都让开它们；
 * footing 是楼脚的铺面与杂物：水管碰到它们就只落到一楼楼板。
 */
export const buildKowloonBlocks = (
    materials: MachiMaterials,
    seed: string | number,
    avoid: readonly THREE.Box3[],
    signs: readonly THREE.Box3[],
    footing: readonly THREE.Box3[] = [],
): KowloonBlockParts => {
    const random = createVisualizerRng(`kowloon:blocks:${seed}`);
    const frame = materials.toon('windowFrame');
    const slab = materials.toon('slab');
    const cageMaterials = [materials.toon('cage'), materials.toon('rust')];
    const ac = materials.toon('ac');
    const acGrille = materials.toon('acGrille');
    const pipe = materials.toon('pipe');
    const bamboo = materials.toon('bamboo');
    const stain = materials.toon('stain');
    const blocks: THREE.Object3D[] = [];
    const lit: InstanceSlot[] = [];
    const dark: InstanceSlot[] = [];
    const clothes: InstanceSlot[] = [];
    const drips: MachiDrip[] = [];
    /** 伸出墙外的东西（加建、铁窗笼、冷气机、晾衫竹连衣服）各占的地方：后放的让开先放的，楼上的冷气机不插进楼下的
     * 晾衫竹、铁窗笼，楼角两面伸出来的竹竿不交叉。claim 放得下就占住。 */
    const outward: THREE.Box3[] = [];
    const claim = (box: THREE.Box3) => {
        if (hitsAny(box, outward)) return false;
        outward.push(box);
        return true;
    };
    const overhead = [...signs, ...avoid];
    // 掏空的门面（酒吧）也算楼脚的东西。
    const ground = [...footing, ...BLOCKS.flatMap(block => (block.hollow ? [new THREE.Box3(
        new THREE.Vector3(block.hollow.x0, 0, block.z1 - 0.05),
        new THREE.Vector3(block.hollow.x1, block.hollow.y1, block.z1 + 0.5),
    )] : []))];

    const glass = (face: Face, s: number, y: number, w: number, h: number, out: number) => {
        const slot = { position: facePoint(face, s, y, out), rotationY: face.rotationY, scale: new THREE.Vector3(w, h, 1) };
        if (random() < 0.46) lit.push({ ...slot, color: WINDOW_LIGHTS[pickWeighted(random, WINDOW_WEIGHTS)] });
        else dark.push(slot);
    };

    BLOCKS.forEach(block => {
        const parts: THREE.Object3D[] = [];
        const wall = materials.toon(block.wall);
        const hollow = block.hollow;
        if (hollow) {
            // 一楼掏空（酒吧）：上面一整块，下面后、左、右三块围着。
            parts.push(
                boxSpan(wall, block.x0, block.x1, hollow.y1, block.height, block.z0, block.z1, { radius: 0.02, name: 'Body' }),
                boxSpan(wall, block.x0, block.x1, 0, hollow.y1, block.z0, hollow.z0, { radius: 0.02, name: 'Body' }),
                boxSpan(wall, block.x0, hollow.x0, 0, hollow.y1, hollow.z0, block.z1, { radius: 0.02, name: 'Body' }),
                boxSpan(wall, hollow.x1, block.x1, 0, hollow.y1, hollow.z0, block.z1, { radius: 0.02, name: 'Body' }),
            );
        } else {
            parts.push(boxSpan(wall, block.x0, block.x1, 0, block.height, block.z0, block.z1, { radius: 0.02, name: 'Body' }));
        }
        facesOf(block).forEach(face => {
            // 底座边上的外墙：只在镜头转过去时看得到，铺窗但不加伸出去的东西。
            const probe = facePoint(face, face.width / 2, block.height - 0.5, 0.2);
            const outer = Math.abs(probe.x) > 6 || Math.abs(probe.z) > 6;
            // 楼板线：每层一道；有几道贴着一段霓虹灯带（粉或青）。
            for (let y = FLOORS.ground; y < block.height - 0.3; y += FLOORS.height) {
                parts.push(faceBox(slab, face, face.width / 2, y - 0.03, [face.width, 0.06, 0.1], 0.0, 'Slab'));
                if (!outer && random() < 0.14) {
                    const length = Math.min(face.width - 0.2, 0.9 + random() * 1.6);
                    const s = 0.1 + length / 2 + random() * (face.width - 0.2 - length);
                    if (!insideAnyBlock(facePoint(face, s, y + 0.1, 0.15)) && !insideAny(facePoint(face, s, y, 0.1), avoid)) {
                        parts.push(faceBox(materials.glow(random() < 0.55 ? 'stripPink' : 'stripCyan'), face, s, y + 0.03, [length, 0.035, 0.03], 0.06, 'Strip'));
                    }
                }
            }
            const columns = Math.max(1, Math.floor((face.width - 0.2) / 0.64));
            const spacing = face.width / columns;
            // 水管：一两根竖着的，走在两列窗之间（只有一列窗就贴着楼角），从楼顶下来。挡着歌词屏、招牌的不装；
            // 楼脚有铺面、杂物、掏空的门面，就只落到一楼楼板。水管也占地方，旁边的铁窗笼、加建让开它。
            const pipes = 1 + Math.floor(random() * 2);
            for (let index = 0; index < pipes; index += 1) {
                const pick = random();
                const s = columns > 1 ? (1 + Math.floor(pick * (columns - 1))) * spacing : (pick < 0.5 ? 0.12 : face.width - 0.12);
                if (insideAnyBlock(facePoint(face, s, block.height - 0.4, 0.12))) continue;
                const top = block.height - 0.1;
                const bottom = hitsAny(faceBounds(face, s - 0.05, s + 0.05, 0, FLOORS.ground, 0.04, 0.14), ground) ? FLOORS.ground - 0.03 : 0;
                const bounds = faceBounds(face, s - 0.05, s + 0.05, bottom, top, 0.04, 0.14);
                if (hitsAny(bounds, overhead) || !claim(bounds)) continue;
                const at = facePoint(face, s, 0, 0.09);
                parts.push(cylinderAt(pipe, 0.045, top - bottom, [at.x, bottom, at.z], { name: 'Pipe', segments: 6 }));
            }
            for (let y = FLOORS.ground; y + 0.85 <= block.height - 0.15; y += FLOORS.height) {
                for (let column = 0; column < columns; column += 1) {
                    const s = (column + 0.5) * spacing + (random() - 0.5) * 0.08;
                    const center = y + 0.55;
                    const probes = [-0.27, 0, 0.27].map(ds => facePoint(face, s + ds, center, 0.12));
                    if (probes.some(point => insideAnyBlock(point))) continue;
                    if (probes.some(point => insideAny(point, avoid))) continue;
                    const blocked = [...signs, ...avoid];
                    const nearSign = (out: number, dy = 0) => [-0.26, 0, 0.26].some(ds => insideAny(facePoint(face, s + ds, center + dy, out), blocked));
                    const roll = random();
                    // 封出去的加建小间：自己一扇小窗。
                    if (!outer && roll < 0.08 && !nearSign(0.3) && claim(faceBounds(face, s - 0.3, s + 0.3, y + 0.06, y + 0.92, 0, 0.4))) {
                        const color = random() < 0.5 ? 'wallD' : 'wallB';
                        parts.push(faceBox(materials.toon(color), face, s, y + 0.06, [0.6, 0.86, 0.4], 0.2, 'Addition'));
                        parts.push(faceBox(frame, face, s, y + 0.3, [0.42, 0.44, 0.04], 0.41, 'Frame'));
                        glass(face, s, center + 0.02, 0.32, 0.34, 0.435);
                        continue;
                    }
                    parts.push(faceBox(frame, face, s, center - 0.3, [0.46, 0.6, 0.06], 0.0, 'Frame'));
                    parts.push(faceBox(slab, face, s, center - 0.33, [0.52, 0.04, 0.12], 0.02, 'Sill'));
                    glass(face, s, center, 0.36, 0.48, 0.035);
                    if (outer) continue;
                    if (roll < 0.36 && !nearSign(0.15) && claim(faceBounds(face, s - 0.27, s + 0.27, center - 0.37, center + 0.37, 0, 0.25))) {
                        // 铁窗笼：顶板、底板、前面几根竖枝、一道横枝、两侧的竖枝。
                        const material = cageMaterials[random() < 0.35 ? 1 : 0]!;
                        const depth = 0.24;
                        const bottom = center - 0.34;
                        const top = center + 0.34;
                        parts.push(faceBox(material, face, s, top, [0.54, 0.03, depth], depth / 2, 'Cage'));
                        parts.push(faceBox(material, face, s, bottom - 0.03, [0.54, 0.03, depth], depth / 2, 'Cage'));
                        [-0.25, -0.125, 0, 0.125, 0.25].forEach(ds => parts.push(faceBox(material, face, s + ds, bottom, [0.02, top - bottom, 0.02], depth, 'Cage')));
                        parts.push(faceBox(material, face, s, center, [0.54, 0.02, 0.02], depth, 'Cage'));
                        [-0.25, 0.25].forEach(ds => parts.push(faceBox(material, face, s + ds, center, [0.02, 0.02, depth], depth / 2, 'Cage')));
                        // 笼里偶尔一盆绿。
                        if (random() < 0.4) parts.push(faceBox(materials.toon('plant'), face, s + (random() - 0.5) * 0.24, bottom, [0.14, 0.14, 0.14], 0.14, 'Plant'));
                    } else if (roll < 0.7 && !nearSign(0.2, -0.4) && claim(faceBounds(face, s - 0.21, s + 0.21, center - 0.72, center - 0.42, 0, 0.33))) {
                        // 冷气机：窗下，伸出墙外，前面一块深色格栅；下雨时前沿滴水。
                        const acY = center - 0.72;
                        parts.push(faceBox(ac, face, s, acY, [0.42, 0.3, 0.32], 0.16, 'AC'));
                        parts.push(faceBox(acGrille, face, s - 0.04, acY + 0.05, [0.28, 0.2, 0.02], 0.325, 'AC'));
                        if (random() < 0.45) {
                            const length = 0.45 + random() * 0.7;
                            parts.push(faceBox(stain, face, s + (random() - 0.5) * 0.2, acY - length, [0.08 + random() * 0.08, length, 0.012], 0.006, 'Stain'));
                        }
                        if (drips.length < 28 && random() < 0.6) {
                            const at = facePoint(face, s + 0.12, acY, 0.3);
                            drips.push({ x: at.x, z: at.z, from: acY, to: LEVEL.ground, period: 1.4 + random() * 2.2, phase: random() });
                        }
                    } else if (roll < 0.82 && !nearSign(0.6, 0.35) && claim(faceBounds(face, s - 0.03, s + 0.03, center - 0.08, center + 0.4, 0, 0.96))) {
                        // 晾衫竹：从窗顶伸出去，挂两三件。
                        const poleY = center + 0.38;
                        const from = facePoint(face, s, poleY, 0.02);
                        const to = facePoint(face, s, poleY, 0.95);
                        const result = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.93, 5), bamboo, { name: 'Bamboo', castShadow: false });
                        result.position.copy(from).add(to).multiplyScalar(0.5);
                        result.quaternion.setFromUnitVectors(UP, face.normal);
                        parts.push(result);
                        // 衣服都在竹竿下同一个平面里，一件挨一件、中间留缝（叠着的两件会闪）；挂不下就一起收窄。
                        const count = 2 + Math.floor(random() * 2);
                        const pieces = Array.from({ length: count }, () => ({
                            w: 0.16 + random() * 0.12,
                            h: 0.26 + random() * 0.18,
                            shift: random(),
                            color: CLOTHES[Math.floor(random() * CLOTHES.length)],
                        }));
                        const [near, far, gap] = [0.12, 0.92, 0.03];
                        const room = far - near - gap * (count - 1);
                        const total = pieces.reduce((sum, piece) => sum + piece.w, 0);
                        const narrow = Math.min(1, room / total);
                        const slack = (room - total * narrow) / count;
                        let out = near;
                        pieces.forEach(piece => {
                            const w = piece.w * narrow;
                            out += slack * piece.shift;
                            clothes.push({
                                position: facePoint(face, s, poleY - piece.h / 2 - 0.01, out + w / 2),
                                rotationY: face.rotationY + Math.PI / 2,
                                scale: new THREE.Vector3(w, piece.h, 0.018),
                                color: piece.color,
                            });
                            out += w + gap + slack * (1 - piece.shift);
                        });
                    }
                }
            }
        });
        // 楼顶：一层油毡面、一圈女儿墙，上面摆水箱、天线、小屋、锅盖、冷气机。
        const top = block.height;
        parts.push(boxSpan(materials.toon('roofTar'), block.x0 + 0.06, block.x1 - 0.06, top, top + 0.03, block.z0 + 0.06, block.z1 - 0.06, { radius: 0.01, name: 'Roof' }));
        const parapet = materials.toon('slab');
        parts.push(boxSpan(parapet, block.x0, block.x1, top, top + 0.26, block.z1 - 0.08, block.z1, { radius: 0.01, name: 'Parapet' }));
        parts.push(boxSpan(parapet, block.x0, block.x1, top, top + 0.26, block.z0, block.z0 + 0.08, { radius: 0.01, name: 'Parapet' }));
        parts.push(boxSpan(parapet, block.x0, block.x0 + 0.08, top, top + 0.26, block.z0, block.z1, { radius: 0.01, name: 'Parapet' }));
        parts.push(boxSpan(parapet, block.x1 - 0.08, block.x1, top, top + 0.26, block.z0, block.z1, { radius: 0.01, name: 'Parapet' }));
        parts.push(...buildRoofClutter(materials, block, random, avoid));
        blocks.push(group(`Block/${block.name}`, ...parts));
    });

    const glassGeometry = new THREE.PlaneGeometry(1, 1);
    const litMaterial = materials.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    litMaterial.name = 'machi:glow:windows';
    const litWindows = instanced(glassGeometry, litMaterial, lit, 'Windows/lit');
    const darkWindows = instanced(glassGeometry, materials.toon('windowDark'), dark, 'Windows/dark');
    const clothesMesh = instanced(new THREE.BoxGeometry(1, 1, 1), materials.product, clothes, 'Laundry', true);
    return {
        group: group('Blocks', ...blocks, litWindows, darkWindows, clothesMesh),
        litWindows: { mesh: litWindows, material: litMaterial },
        darkWindows,
        clothes: clothesMesh,
        drips,
    };
};

/** 一栋楼顶上的杂物：按格子撒，碰到更高的楼、广告架就不放。 */
const buildRoofClutter = (materials: MachiMaterials, block: KowloonBlock, random: () => number, avoid: readonly THREE.Box3[]) => {
    const parts: THREE.Object3D[] = [];
    const top = block.height + 0.03;
    const tank = materials.toon('tank');
    const metal = materials.toon('antenna');
    const fits = (x: number, z: number, r: number, h: number) => {
        const corners = [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]];
        return corners.every(([cx, cz]) => {
            if (cx! < block.x0 + 0.15 || cx! > block.x1 - 0.15 || cz! < block.z0 + 0.15 || cz! > block.z1 - 0.15) return false;
            const point = new THREE.Vector3(cx, top + h * 0.5, cz);
            return !insideAnyBlock(point) && !insideAny(point, avoid);
        });
    };
    const step = 0.95;
    for (let x = block.x0 + 0.6; x < block.x1 - 0.4; x += step) {
        for (let z = block.z0 + 0.6; z < block.z1 - 0.4; z += step) {
            const px = x + (random() - 0.5) * 0.4;
            const pz = z + (random() - 0.5) * 0.4;
            const roll = random();
            if (roll < 0.22 && fits(px, pz, 0.4, 1.0)) {
                // 水箱：四脚架上一个圆桶。
                [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach(([dx, dz]) => {
                    parts.push(boxAt(metal, [0.05, 0.36, 0.05], [px + dx!, top, pz + dz!], { radius: 0, name: 'TankLeg' }));
                });
                parts.push(cylinderAt(tank, 0.33, 0.6, [px, top + 0.36, pz], { name: 'Tank', segments: 14 }));
            } else if (roll < 0.36 && fits(px, pz, 0.55, 1.0)) {
                // 天台小屋：一间铁皮屋，前面一扇门。
                const color = random() < 0.5 ? 'wallD' : 'shutter';
                parts.push(boxAt(materials.toon(color), [1.0, 0.85, 0.85], [px, top, pz], { radius: 0.02, name: 'Shack' }));
                parts.push(boxAt(materials.toon('roofTar'), [1.12, 0.05, 0.98], [px, top + 0.85, pz], { radius: 0.01, name: 'Shack' }));
                parts.push(boxAt(materials.toon('windowDark'), [0.32, 0.62, 0.04], [px + 0.2, top, pz + 0.43], { radius: 0, name: 'Shack' }));
            } else if (roll < 0.68 && fits(px, pz, 0.32, 1.4)) {
                // 鱼骨天线：一根杆，三道横枝。
                const height = 0.9 + random() * 0.6;
                parts.push(cylinderAt(metal, 0.018, height, [px, top, pz], { name: 'Antenna', segments: 5 }));
                const yaw = random() * Math.PI;
                [0.55, 0.75, 0.92].forEach((t, index) => {
                    const bar = boxAt(metal, [0.62 - index * 0.12, 0.016, 0.016], [px, top + height * t, pz], { radius: 0, name: 'Antenna' });
                    bar.rotation.y = yaw;
                    parts.push(bar);
                });
            } else if (roll < 0.76 && fits(px, pz, 0.3, 0.8)) {
                // 锅盖：短杆上一只碟，朝天斜着。
                parts.push(cylinderAt(metal, 0.025, 0.35, [px, top, pz], { name: 'Dish', segments: 5 }));
                const dish = mesh(new THREE.SphereGeometry(0.26, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.32), materials.toon('ac'), { name: 'Dish' });
                dish.position.set(px, top + 0.42, pz);
                dish.rotation.set(-0.9 - random() * 0.4, random() * Math.PI * 2, 0, 'YXZ');
                parts.push(dish);
            } else if (roll < 0.86 && fits(px, pz, 0.36, 0.6)) {
                parts.push(boxAt(materials.toon('ac'), [0.62, 0.48, 0.48], [px, top, pz], { radius: 0.02, name: 'RoofAC' }));
                parts.push(boxAt(materials.toon('acGrille'), [0.4, 0.04, 0.4], [px, top + 0.48, pz], { radius: 0, name: 'RoofAC' }));
            }
        }
    }
    return parts;
};
