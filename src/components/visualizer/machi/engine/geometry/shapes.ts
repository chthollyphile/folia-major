import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// src/components/visualizer/machi/engine/geometry/shapes.ts
// 搭街角用的小工具：圆角盒、按底面放置的网格、命名 Group、悬链线电线，以及建完后的静态合批
// （同一材质的静止网格合成一个，命名的顶层 Group 留着，动的件和 InstancedMesh 不碰）。

/**
 * 圆角盒几何的缓存：同尺寸同圆角的盒子共用一份几何。缓存属于一个运行时（建场景时用 withGeometryCache 套上），
 * 换样式时两个运行时同时在，各自销毁各自的。
 */
export type MachiGeometryCache = Map<string, THREE.BufferGeometry>;

let activeCache: MachiGeometryCache = new Map();
const sharedGeometries = new WeakSet<THREE.BufferGeometry>();

/** 在 cache 上同步地建一段几何。 */
export const withGeometryCache = <T>(cache: MachiGeometryCache, build: () => T): T => {
    const previous = activeCache;
    activeCache = cache;
    try {
        return build();
    } finally {
        activeCache = previous;
    }
};

/** 轻微圆角的盒子（默认 3cm），避免盒子堆叠的生硬边。 */
export const roundedBox = (width: number, height: number, depth: number, radius = 0.03, segments = 2) => {
    const r = Math.min(radius, width / 2 - 1e-3, height / 2 - 1e-3, depth / 2 - 1e-3);
    const key = `${width.toFixed(3)}:${height.toFixed(3)}:${depth.toFixed(3)}:${r.toFixed(3)}:${segments}`;
    let geometry = activeCache.get(key);
    if (!geometry) {
        geometry = r > 0.004 ? new RoundedBoxGeometry(width, height, depth, segments, r) : new THREE.BoxGeometry(width, height, depth);
        activeCache.set(key, geometry);
        sharedGeometries.add(geometry);
    }
    return geometry;
};

export interface MeshOptions {
    name?: string;
    castShadow?: boolean;
    receiveShadow?: boolean;
    /** 会动、会换材质亮度的件：静态合批跳过它。 */
    dynamic?: boolean;
}

export const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, options: MeshOptions = {}) => {
    const result = new THREE.Mesh(geometry, material);
    result.name = options.name ?? '';
    result.castShadow = options.castShadow ?? true;
    result.receiveShadow = options.receiveShadow ?? true;
    if (options.dynamic) result.userData.dynamic = true;
    return result;
};

/** 按“底面中心”放一个盒子：x、z 是中心，y 是底面高度。 */
export const boxAt = (
    material: THREE.Material,
    size: [number, number, number],
    at: [number, number, number],
    options: MeshOptions & { radius?: number; rotationY?: number } = {},
) => {
    const [width, height, depth] = size;
    const result = mesh(roundedBox(width, height, depth, options.radius ?? 0.03), material, options);
    result.position.set(at[0], at[1] + height / 2, at[2]);
    if (options.rotationY) result.rotation.y = options.rotationY;
    return result;
};

/** 两个角点围出的盒子（x0..x1、y0..y1、z0..z1）。 */
export const boxSpan = (
    material: THREE.Material,
    x0: number, x1: number,
    y0: number, y1: number,
    z0: number, z1: number,
    options: MeshOptions & { radius?: number } = {},
) => boxAt(
    material,
    [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)],
    [(x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2],
    options,
);

/** 竖直圆柱（底面在 y）。 */
export const cylinderAt = (
    material: THREE.Material,
    radius: number,
    height: number,
    at: [number, number, number],
    options: MeshOptions & { radiusTop?: number; segments?: number } = {},
) => {
    const geometry = new THREE.CylinderGeometry(options.radiusTop ?? radius, radius, height, options.segments ?? 12);
    const result = mesh(geometry, material, options);
    result.position.set(at[0], at[1] + height / 2, at[2]);
    return result;
};

/** 两点之间的一根管子（支架、扶手、车架）。 */
export const tubeBetween = (
    material: THREE.Material,
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    options: MeshOptions & { segments?: number } = {},
) => {
    const length = from.distanceTo(to);
    const geometry = new THREE.CylinderGeometry(radius, radius, length, options.segments ?? 8);
    const result = mesh(geometry, material, options);
    result.position.copy(from).add(to).multiplyScalar(0.5);
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    return result;
};

/** 下垂的电线：两点之间的抛物线近似悬链线，下垂量 sag 米。 */
export const sagWire = (
    material: THREE.Material,
    from: THREE.Vector3,
    to: THREE.Vector3,
    sag: number,
    radius = 0.012,
) => {
    const points: THREE.Vector3[] = [];
    const steps = 16;
    for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const point = from.clone().lerp(to, t);
        point.y -= sag * 4 * t * (1 - t);
        points.push(point);
    }
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, radius, 4, false);
    return mesh(geometry, material, { castShadow: false, receiveShadow: false });
};

export const group = (name: string, ...children: THREE.Object3D[]) => {
    const result = new THREE.Group();
    result.name = name;
    children.forEach(child => result.add(child));
    return result;
};

/** 统一成 position / normal / uv（有顶点色的再加 color）的非索引几何，才能合在一起。 */
const normalizeForMerge = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => {
    const result = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    result.applyMatrix4(matrix);
    Object.keys(result.attributes).forEach(name => {
        if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') result.deleteAttribute(name);
    });
    if (!result.attributes.normal) result.computeVertexNormals();
    if (!result.attributes.uv) {
        const count = result.attributes.position!.count;
        result.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    result.morphAttributes = {};
    result.clearGroups();
    return result;
};

/**
 * 静态合批：把 root 下每个直接子 Group 里静止的普通网格按材质（和投影 / 受影设置）合成一个网格，挂回那个 Group。
 * 会动的件（userData.dynamic）、InstancedMesh、透明件以外的特殊网格都留着原样。名字留在 Group 上，结构仍然可读。
 */
export const bakeStatic = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    root.children.forEach(top => {
        const inverse = new THREE.Matrix4().copy(top.matrixWorld).invert();
        const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; layers: number; parts: THREE.BufferGeometry[] }>();
        const removals: THREE.Mesh[] = [];
        top.traverse(object => {
            if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
            if (object.userData.dynamic || Array.isArray(object.material)) return;
            let ancestor: THREE.Object3D | null = object.parent;
            while (ancestor && ancestor !== top) {
                if (ancestor.userData.dynamic) return;
                ancestor = ancestor.parent;
            }
            const material = object.material as THREE.Material;
            const key = `${material.uuid}:${object.castShadow ? 1 : 0}:${object.receiveShadow ? 1 : 0}:${object.layers.mask}`;
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { material, cast: object.castShadow, receive: object.receiveShadow, layers: object.layers.mask, parts: [] };
                buckets.set(key, bucket);
            }
            const local = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
            bucket.parts.push(normalizeForMerge(object.geometry, local));
            removals.push(object);
        });
        buckets.forEach(bucket => {
            if (bucket.parts.length < 2) {
                bucket.parts.forEach(part => part.dispose());
                return;
            }
            // 同一桶里有的带顶点色、有的不带：不带的补白色，属性才对得齐。
            if (bucket.parts.some(part => part.attributes.color)) {
                bucket.parts.forEach(part => {
                    if (part.attributes.color) return;
                    const count = part.attributes.position!.count;
                    part.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
                });
            }
            const merged = mergeGeometries(bucket.parts, false);
            bucket.parts.forEach(part => part.dispose());
            if (!merged) return;
            const result = new THREE.Mesh(merged, bucket.material);
            result.name = `${top.name}:${bucket.material.name || 'merged'}`;
            result.castShadow = bucket.cast;
            result.receiveShadow = bucket.receive;
            result.layers.mask = bucket.layers;
            top.add(result);
        });
        removals.forEach(object => {
            const key = `${(object.material as THREE.Material).uuid}:${object.castShadow ? 1 : 0}:${object.receiveShadow ? 1 : 0}:${object.layers.mask}`;
            const bucket = buckets.get(key);
            if (!bucket || bucket.parts.length < 2) return;
            object.removeFromParent();
            // 圆角盒几何在缓存里共用，由运行时统一释放；其余几何只属于这个网格。
            if (!sharedGeometries.has(object.geometry)) object.geometry.dispose();
        });
    });
};
