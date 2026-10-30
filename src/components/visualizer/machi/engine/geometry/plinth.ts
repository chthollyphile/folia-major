import * as THREE from 'three';
import type { MachiMaterials } from '../materials';
import { group, mesh, roundedBox } from './shapes';

// src/components/visualizer/machi/engine/geometry/plinth.ts
// 三个场景共用的底座：分层的微缩台座（碎石层、土层、深色底框，四角圆），和贴在顶面上的路面 / 场地薄板
// （湿地面材质装在这些薄板上）。

/** 底座：12m 见方、0.6m 厚，顶面就是路面（y = 0）。 */
export const MACHI_BASE = { half: 6, depth: 0.6, radius: 0.12 } as const;

/** 台座：三层土石加一圈深色底框，四角圆。 */
export const buildMachiPlinth = (materials: MachiMaterials) => {
    const size = MACHI_BASE.half * 2;
    const layers = [
        { role: 'plinthTop', y0: -0.1, y1: 0, inset: 0 },
        { role: 'plinthMid', y0: -0.3, y1: -0.1, inset: 0.012 },
        { role: 'plinthLow', y0: -0.52, y1: -0.3, inset: 0.006 },
    ];
    const parts = layers.map(layer => {
        const width = size - layer.inset * 2;
        const part = mesh(roundedBox(width, layer.y1 - layer.y0, width, MACHI_BASE.radius, 3), materials.toon(layer.role), { name: `Plinth/${layer.role}` });
        part.position.set(0, (layer.y0 + layer.y1) / 2, 0);
        return part;
    });
    const trim = mesh(roundedBox(size + 0.08, 0.1, size + 0.08, MACHI_BASE.radius + 0.04, 3), materials.toon('plinthTrim'), { name: 'Plinth/trim' });
    trim.position.set(0, -MACHI_BASE.depth + 0.05, 0);
    return group('Base/Plinth', ...parts, trim);
};

const SURFACE_LIFT = 0.002;

/** 沿 x、z 的一片平板顶面（x0..x1、z0..z1，高 y）：会换成湿地面材质，所以是动的件、不合批。 */
export const machiSurface = (material: THREE.Material, x0: number, x1: number, z0: number, z1: number, y: number, name: string) => {
    const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const result = mesh(geometry, material, { name, castShadow: false, receiveShadow: true, dynamic: true });
    result.position.set((x0 + x1) / 2, y + SURFACE_LIFT, (z0 + z1) / 2);
    return result;
};
