import * as THREE from 'three';
import { roundedBox } from '../geometry/shapes';
import { MACHI_REFLECT_LAYER } from '../fx/reflection';
import type { MachiColorBlend, MachiMaterials } from '../materials';
import { MACHI_GLOSS } from '../sheen';
import { resolveMachiCar, type MachiLane } from './schedules';

// src/components/visualizer/machi/engine/actors/traffic.ts
// 偶尔开过的车：一辆轻型车（有时是出租车，车顶亮着灯），按 schedules 的窗口挑车道、颜色；车道和路面高度由场景给。
// 车身、车灯都带底座边缘的裁切面，所以车是从底座边缘“开出来”的，不会悬在底座外面。前灯在湿路面上照出一块会移动的光斑，
// 前灯和尾灯进倒影图层，水洼里映得出来。脚下一块软阴影代替投影（阴影图不为它重画）。

const WHEEL_RADIUS = 0.27;
/** 开过的车的车身尺寸（沿车长、车宽）：场景按它定路宽和车道。 */
export const MACHI_TRAFFIC_CAR = { length: 3.3, width: 1.46 } as const;
/** 车身颜色：白、银、黑、藏青、红，最后一个是出租车（黄、车顶灯）。 */
const CAR_COLORS = ['#e8eaee', '#aeb5bf', '#25292f', '#22385f', '#b8322e', '#f0c23a'];
const TAXI_INDEX = CAR_COLORS.length - 1;

/** 底座边缘的四个裁切面（只留 |x|、|z| ≤ 6 的部分）。 */
export const createBaseClippingPlanes = (half = 6) => [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), half),
    new THREE.Plane(new THREE.Vector3(1, 0, 0), half),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), half),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), half),
];

/** 柔边的椭圆贴图：脚下阴影、前灯光斑共用。 */
export const createSoftEllipseTexture = (forward = false) => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = (x + 0.5) / size * 2 - 1;
            const v = (y + 0.5) / size * 2 - 1;
            const d = Math.hypot(u, v);
            // 前灯光斑：靠车的一侧（u 小）更亮。
            const bias = forward ? 0.45 + 0.55 * (1 - (u + 1) / 2) : 1;
            const value = Math.round(255 * Math.max(0, 1 - d) ** 1.6 * bias);
            const index = (y * size + x) * 4;
            image.data[index] = value;
            image.data[index + 1] = value;
            image.data[index + 2] = value;
            image.data[index + 3] = forward ? 255 : value;
        }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
};

export class MachiTraffic {
    readonly group = new THREE.Group();
    private readonly car = new THREE.Group();
    private readonly body: THREE.MeshToonMaterial;
    private readonly taxiLamp: THREE.Mesh;
    private readonly wheels: THREE.Mesh[] = [];
    private readonly headlight: THREE.MeshBasicMaterial;
    private readonly taillight: THREE.MeshBasicMaterial;
    private readonly pool: THREE.MeshBasicMaterial;
    private readonly textures: THREE.Texture[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private colorIndex = -1;
    /** 这一帧路上有没有车（暂停时补帧、阴影都不用管它）。 */
    active = false;

    constructor(
        materials: MachiMaterials,
        private readonly blend: MachiColorBlend,
        clipping: THREE.Plane[],
        private readonly lanes: readonly MachiLane[],
        private readonly roadY: number,
    ) {
        this.group.name = 'Traffic';
        const clip = <T extends THREE.Material>(material: T) => {
            material.clippingPlanes = clipping;
            return materials.track(material);
        };
        this.body = clip(materials.snowy(new THREE.MeshToonMaterial({ color: CAR_COLORS[0], gradientMap: materials.gradient }), MACHI_GLOSS.paint));
        const glass = clip(materials.snowy(new THREE.MeshToonMaterial({ color: '#1a2130', gradientMap: materials.gradient }), MACHI_GLOSS.glass));
        const rubber = clip(materials.snowy(new THREE.MeshToonMaterial({ color: '#15171c', gradientMap: materials.gradient })));
        this.headlight = clip(new THREE.MeshBasicMaterial({ color: 0xffffff }));
        this.taillight = clip(new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const lampMaterial = clip(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.6) }));
        const shadowTexture = createSoftEllipseTexture();
        const poolTexture = createSoftEllipseTexture(true);
        this.textures.push(shadowTexture, poolTexture);
        const shadow = clip(new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture, transparent: true, opacity: 0.55, depthWrite: false }));
        this.pool = clip(new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));

        const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, name: string) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            mesh.name = name;
            this.car.add(mesh);
            return mesh;
        };
        // 车身沿 +x，车头在 +x。
        part(roundedBox(MACHI_TRAFFIC_CAR.length, 0.56, MACHI_TRAFFIC_CAR.width, 0.15), this.body, 0, 0.5, 0, 'Body');
        part(roundedBox(1.92, 0.5, 1.32, 0.13), glass, -0.22, 1.02, 0, 'Cabin');
        part(roundedBox(1.78, 0.08, 1.36, 0.04), this.body, -0.22, 1.3, 0, 'Roof');
        this.taxiLamp = part(roundedBox(0.36, 0.14, 0.2, 0.03), lampMaterial, -0.2, 1.41, 0, 'TaxiLamp');
        [-1, 1].forEach(side => {
            const head = part(roundedBox(0.06, 0.13, 0.32, 0.02), this.headlight, 1.64, 0.6, side * 0.48, 'Headlight');
            const tail = part(roundedBox(0.06, 0.12, 0.26, 0.02), this.taillight, -1.64, 0.64, side * 0.52, 'Taillight');
            head.layers.enable(MACHI_REFLECT_LAYER);
            tail.layers.enable(MACHI_REFLECT_LAYER);
        });
        const wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.2, 14);
        wheelGeometry.rotateX(Math.PI / 2);
        this.geometries.push(wheelGeometry);
        [[1.05, 0.66], [1.05, -0.66], [-1.05, 0.66], [-1.05, -0.66]].forEach(([x, z]) => {
            this.wheels.push(part(wheelGeometry, rubber, x!, WHEEL_RADIUS, z!, 'Wheel'));
        });
        const shadowGeometry = new THREE.PlaneGeometry(3.7, 1.9);
        shadowGeometry.rotateX(-Math.PI / 2);
        const poolGeometry = new THREE.PlaneGeometry(3.6, 2.4);
        poolGeometry.rotateX(-Math.PI / 2);
        this.geometries.push(shadowGeometry, poolGeometry);
        const shadowMesh = part(shadowGeometry, shadow, 0, 0.004, 0, 'Shadow');
        shadowMesh.renderOrder = 1;
        const poolMesh = part(poolGeometry, this.pool, 3.4, 0.008, 0, 'HeadlightPool');
        poolMesh.renderOrder = 1;
        this.car.children.forEach(child => {
            child.castShadow = false;
            child.receiveShadow = false;
        });
        this.car.visible = false;
        this.group.add(this.car);
        this.syncColors();
    }

    syncColors() {
        this.headlight.color.copy(this.blend.get('streetLight')).multiplyScalar(3.2);
        this.taillight.color.copy(this.blend.get('stopRed')).multiplyScalar(2.6);
        this.pool.color.copy(this.blend.get('streetLight')).multiplyScalar(0.3);
    }

    /** 按氛围时间摆车；没有车时藏起来。 */
    update(time: number, seed: string | number, chance: number) {
        const pass = resolveMachiCar(time, seed, this.lanes, chance);
        this.active = !!pass;
        this.car.visible = !!pass;
        if (!pass) return;
        const lane = this.lanes[pass.lane]!;
        const dx = lane.to[0] - lane.from[0];
        const dz = lane.to[1] - lane.from[1];
        const length = Math.hypot(dx, dz);
        const t = pass.distance / length;
        this.car.position.set(lane.from[0] + dx * t, this.roadY, lane.from[1] + dz * t);
        this.car.rotation.y = Math.atan2(-dz, dx);
        this.wheels.forEach(wheel => { wheel.rotation.z = -pass.distance / WHEEL_RADIUS; });
        const colorIndex = pass.colorIndex % CAR_COLORS.length;
        if (colorIndex !== this.colorIndex) {
            this.colorIndex = colorIndex;
            this.body.color.set(CAR_COLORS[colorIndex]!);
            this.taxiLamp.visible = colorIndex === TAXI_INDEX;
        }
    }

    dispose() {
        this.textures.forEach(texture => texture.dispose());
        this.geometries.forEach(geometry => geometry.dispose());
    }
}
