import * as THREE from 'three';
import type { MachiMaterials } from '../../engine/materials';
import { BASE, LEVEL, ROAD } from './layout';
import { buildMachiPlinth, machiSurface as surface } from '../../engine/geometry/plinth';
import { boxSpan, group, mesh, roundedBox } from '../../engine/geometry/shapes';

// src/components/visualizer/machi/scenes/konbini/base.ts
// 底座 Group "Base"：分层的微缩台座（沥青面、碎石层、土层、深色底框），两条路、路缘、店前的混凝土场地、
// 路对面的窄人行道、两组斑马线和路边线（InstancedMesh）、井盖、排水沟盖板。
// 路面与场地的顶面单独做成薄板（Base/Surfaces），湿路面材质在第三阶段换上去。

export interface KonbiniBaseParts {
    group: THREE.Group;
    /** 沥青路面、场地 / 人行道的顶面：湿路面材质装在它们上面。 */
    roadSurface: THREE.Mesh;
    lotSurfaces: THREE.Mesh[];
}

/** 店前场地与路对面人行道：抬高的混凝土板，四边是路缘石。 */
const buildLots = (materials: MachiMaterials) => {
    const h = BASE.half;
    const slabs: [number, number, number, number][] = [
        [-h, ROAD.inner, -h, ROAD.inner],
        [ROAD.outer, h, -h, ROAD.inner],
        [-h, ROAD.inner, ROAD.outer, h],
        [ROAD.outer, h, ROAD.outer, h],
    ];
    const concrete = materials.toon('concrete');
    const curb = materials.toon('curb');
    const parts: THREE.Object3D[] = [];
    slabs.forEach(([x0, x1, z0, z1], index) => {
        parts.push(boxSpan(concrete, x0 + 0.002, x1 - 0.002, LEVEL.road, LEVEL.lot - 0.004, z0 + 0.002, z1 - 0.002, { radius: 0.01, name: `Lot/slab${index}` }));
    });
    // 路缘石：贴着路的那几条边，比场地略高一点点。
    const c = ROAD.curbWidth;
    const curbTop = LEVEL.lot + 0.012;
    const curbs: [number, number, number, number][] = [
        [-h, ROAD.inner, ROAD.inner - c, ROAD.inner],
        [ROAD.inner - c, ROAD.inner, -h, ROAD.inner],
        [ROAD.outer, h, ROAD.inner - c, ROAD.inner],
        [ROAD.outer, ROAD.outer + c, -h, ROAD.inner],
        [-h, ROAD.inner, ROAD.outer, ROAD.outer + c],
        [ROAD.inner - c, ROAD.inner, ROAD.outer, h],
        [ROAD.outer, h, ROAD.outer, ROAD.outer + c],
        [ROAD.outer, ROAD.outer + c, ROAD.outer, h],
    ];
    curbs.forEach(([x0, x1, z0, z1], index) => {
        parts.push(boxSpan(curb, x0, x1, LEVEL.road, curbTop, z0, z1, { radius: 0.02, name: `Lot/curb${index}` }));
    });
    return group('Base/Lots', ...parts);
};

/** 斑马线、路边线、停止线：同一种白漆，一个 InstancedMesh。 */
const buildRoadPaint = (materials: MachiMaterials) => {
    const h = BASE.half;
    const bars: { x: number; z: number; w: number; d: number }[] = [];
    // 前路上的斑马线：横跨道路，条纹沿 x，间隔沿 z。
    const crossA = { x0: 0.15, x1: 1.95 };
    for (let z = ROAD.inner + 0.42; z < ROAD.outer - 0.3; z += 0.8) {
        bars.push({ x: (crossA.x0 + crossA.x1) / 2, z: z + 0.2, w: crossA.x1 - crossA.x0, d: 0.4 });
    }
    // 右路上的斑马线。
    const crossB = { z0: -0.95, z1: 0.85 };
    for (let x = ROAD.inner + 0.42; x < ROAD.outer - 0.3; x += 0.8) {
        bars.push({ x: x + 0.2, z: (crossB.z0 + crossB.z1) / 2, w: 0.4, d: crossB.z1 - crossB.z0 });
    }
    // 路边线（外侧线），在路口处断开。
    const inset = ROAD.edgeLineInset;
    const lineWidth = 0.1;
    const frontLineSpans: [number, number][] = [[-h, crossA.x0 - 0.3], [crossA.x1 + 0.3, ROAD.inner - 0.1]];
    frontLineSpans.forEach(([x0, x1]) => {
        bars.push({ x: (x0 + x1) / 2, z: ROAD.inner + inset, w: x1 - x0, d: lineWidth });
        bars.push({ x: (x0 + x1) / 2, z: ROAD.outer - inset, w: x1 - x0, d: lineWidth });
    });
    const rightLineSpans: [number, number][] = [[-h, crossB.z0 - 0.3], [crossB.z1 + 0.3, ROAD.inner - 0.1]];
    rightLineSpans.forEach(([z0, z1]) => {
        bars.push({ x: ROAD.inner + inset, z: (z0 + z1) / 2, w: lineWidth, d: z1 - z0 });
        bars.push({ x: ROAD.outer - inset, z: (z0 + z1) / 2, w: lineWidth, d: z1 - z0 });
    });
    // 停止线：斑马线前一条粗白线。
    bars.push({ x: crossA.x0 - 0.45, z: (ROAD.inner + ROAD.outer) / 2 + 0.85, w: 0.3, d: (ROAD.outer - ROAD.inner) / 2 - 0.2 });
    bars.push({ x: (ROAD.inner + ROAD.outer) / 2 - 0.85, z: crossB.z0 - 0.45, w: (ROAD.outer - ROAD.inner) / 2 - 0.2, d: 0.3 });

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const paint = new THREE.InstancedMesh(geometry, materials.toon('roadPaint'), bars.length);
    paint.name = 'Base/RoadPaint';
    paint.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    bars.forEach((bar, index) => {
        matrix.makeScale(bar.w, 1, bar.d);
        matrix.setPosition(bar.x, LEVEL.road + 0.006, bar.z);
        paint.setMatrixAt(index, matrix);
    });
    return paint;
};

/** 井盖与排水沟盖板。 */
const buildRoadFixtures = (materials: MachiMaterials) => {
    const darkMetal = materials.toon('darkMetal');
    const parts: THREE.Object3D[] = [];
    const manhole = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 24), darkMetal, { name: 'Manhole', castShadow: false });
    manhole.position.set(-2.4, LEVEL.road + 0.01, (ROAD.inner + ROAD.outer) / 2 + 0.3);
    parts.push(manhole);
    // 排水沟盖板：沿店前路缘每隔一米一块。
    const grateGeometry = roundedBox(0.7, 0.012, 0.22, 0.004);
    const grates = new THREE.InstancedMesh(grateGeometry, darkMetal, 14);
    grates.name = 'Grates';
    grates.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    let count = 0;
    for (let x = -5.4; x < ROAD.inner - 0.6 && count < 7; x += 1.1, count += 1) {
        matrix.makeTranslation(x, LEVEL.road + 0.006, ROAD.inner + 0.13);
        grates.setMatrixAt(count, matrix);
    }
    for (let z = -5.4; z < ROAD.inner - 0.6 && count < 14; z += 1.1, count += 1) {
        matrix.makeRotationY(Math.PI / 2);
        matrix.setPosition(ROAD.inner + 0.13, LEVEL.road + 0.006, z);
        grates.setMatrixAt(count, matrix);
    }
    grates.count = count;
    parts.push(grates);
    return group('Base/Fixtures', ...parts);
};

export const buildKonbiniBase = (materials: MachiMaterials): KonbiniBaseParts => {
    const h = BASE.half;
    const roadSurface = surface(materials.toon('asphalt'), -h, h, -h, h, LEVEL.road, 'Surface/road');
    const lotSurfaces = [
        surface(materials.toon('concrete'), -h, ROAD.inner - ROAD.curbWidth, -h, ROAD.inner - ROAD.curbWidth, LEVEL.lot, 'Surface/lot'),
        surface(materials.toon('concrete'), ROAD.outer + ROAD.curbWidth, h, -h, ROAD.inner, LEVEL.lot, 'Surface/farRight'),
        surface(materials.toon('concrete'), -h, ROAD.inner, ROAD.outer + ROAD.curbWidth, h, LEVEL.lot, 'Surface/farFront'),
        surface(materials.toon('concrete'), ROAD.outer + ROAD.curbWidth, h, ROAD.outer + ROAD.curbWidth, h, LEVEL.lot, 'Surface/farCorner'),
    ];
    const surfaces = group('Base/Surfaces', roadSurface, ...lotSurfaces);
    surfaces.userData.dynamic = true;
    const base = group(
        'Base',
        buildMachiPlinth(materials),
        buildLots(materials),
        buildRoadPaint(materials),
        buildRoadFixtures(materials),
        surfaces,
    );
    return { group: base, roadSurface, lotSurfaces };
};
