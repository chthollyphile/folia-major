import * as THREE from 'three';
import { createSoftEllipseTexture } from '../../engine/actors/traffic';
import type { MachiColorBlend, MachiMaterials } from '../../engine/materials';
import { BAR, HOLOGRAM, LEVEL, SCREEN, STALL } from './layout';

// src/components/visualizer/machi/scenes/kowloon/kowloonLights.ts
// 城寨酒吧的灯：店里一盏暖里带粉的点光、歌词屏前一盏按屏幕字色的弱光、招牌那一角一盏粉色一盏青色的点光
// （把左排楼面和巷子染上霓虹色）、全息投影一盏青色弱光、大排档一盏暖光、电线杆的街灯一盏朝下的冷白聚光。
// 地上的光斑用加色贴片：门前一片暖、招牌下粉青两片、全息下一片、档口一片、街灯下一圈。夜里霓虹的颜色映在湿地上。

export interface KowloonLightLevels {
    bar: number;
    screen: number;
    neon: number;
    holo: number;
    stall: number;
    lamp: number;
    /** 地上的光斑（白天被日光盖掉）。 */
    pools: number;
}

type LevelKey = Exclude<keyof KowloonLightLevels, 'pools'>;

export class KowloonLights {
    readonly group = new THREE.Group();
    private readonly points: { light: THREE.PointLight; key: string; intensity: number; source: LevelKey }[] = [];
    private readonly lamp: THREE.SpotLight;
    /** 满城霓虹映在墙上的一层底光（夜里才有）。 */
    private readonly glow = new THREE.AmbientLight(0xffffff, 0);
    private readonly pools: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; key: string; level: number; source: LevelKey }[] = [];
    private readonly texture = createSoftEllipseTexture();
    private levels: KowloonLightLevels = { bar: 1, screen: 1, neon: 1, holo: 1, stall: 1, lamp: 1, pools: 1 };

    constructor(private readonly blend: MachiColorBlend, materials: MachiMaterials, lampHead: THREE.Vector3, stallBulb: THREE.Vector3) {
        this.group.name = 'KowloonLights';
        const point = (key: string, intensity: number, distance: number, at: THREE.Vector3, source: LevelKey, name: string) => {
            const light = new THREE.PointLight(0xffffff, intensity, distance, 2);
            light.position.copy(at);
            light.name = `Lights/${name}`;
            this.points.push({ light, key, intensity, source });
            this.group.add(light);
        };
        point('barLight', 4.2, 6, new THREE.Vector3((BAR.x0 + BAR.x1) / 2, 2.3, (BAR.back + BAR.glass) / 2 + 0.3), 'bar', 'bar');
        point('boardLit', 2.2, 6, new THREE.Vector3(SCREEN.x, SCREEN.y - 0.6, SCREEN.z + 1.6), 'screen', 'screen');
        point('neonPink', 3.6, 6.5, new THREE.Vector3(-2.4, 4.3, 1.4), 'neon', 'neonPink');
        point('neonCyan', 2.6, 5.5, new THREE.Vector3(-1.7, 4.9, -0.9), 'neon', 'neonCyan');
        point('holo', 1.6, 4, new THREE.Vector3(HOLOGRAM.x, HOLOGRAM.y - 0.3, HOLOGRAM.z + 0.3), 'holo', 'holo');
        point('interiorLight', 3.0, 4.5, stallBulb.clone().add(new THREE.Vector3(0, -0.1, 0)), 'stall', 'stall');
        this.lamp = new THREE.SpotLight(0xffffff, 20, 9, 0.85, 0.6, 2);
        this.lamp.name = 'Lights/lamp';
        this.lamp.position.copy(lampHead);
        this.lamp.target.position.set(lampHead.x - 0.25, 0, lampHead.z + 0.1);
        this.glow.name = 'Lights/cityGlow';
        this.group.add(this.lamp, this.lamp.target, this.glow);

        const pool = (key: string, level: number, source: LevelKey, size: [number, number], at: [number, number]) => {
            const material = materials.track(new THREE.MeshBasicMaterial({ color: 0xffffff, map: this.texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            const geometry = new THREE.PlaneGeometry(size[0], size[1]).rotateX(-Math.PI / 2);
            const result = new THREE.Mesh(geometry, material);
            result.position.set(at[0], LEVEL.ground + 0.008, at[1]);
            result.renderOrder = 1;
            result.name = `Pool/${source}`;
            this.pools.push({ mesh: result, material, key, level, source });
            this.group.add(result);
        };
        pool('barLight', 0.34, 'bar', [4.8, 2.4], [(BAR.x0 + BAR.x1) / 2, BAR.front + 1.0]);
        pool('neonPink', 0.3, 'neon', [3.6, 4.2], [-2.3, 1.4]);
        pool('neonCyan', 0.22, 'neon', [2.6, 2.4], [-1.6, -0.6]);
        pool('holo', 0.26, 'holo', [2.4, 1.8], [HOLOGRAM.x, HOLOGRAM.z + 0.2]);
        pool('interiorLight', 0.32, 'stall', [2.6, 2.4], [(STALL.x0 + STALL.x1) / 2, STALL.z1 + 0.7]);
        pool('lampCool', 0.4, 'lamp', [3.0, 3.0], [lampHead.x - 0.25, lampHead.z + 0.1]);
        this.sync();
    }

    setLevels(levels: KowloonLightLevels) {
        const previous = this.levels;
        if ((Object.keys(levels) as (keyof KowloonLightLevels)[]).every(key => previous[key] === levels[key])) return;
        this.levels = levels;
        this.sync();
    }

    sync() {
        const levels = this.levels;
        this.points.forEach(({ light, key, intensity, source }) => {
            light.color.copy(this.blend.get(key));
            light.intensity = intensity * levels[source];
        });
        this.glow.color.copy(this.blend.get('cityGlow'));
        this.glow.intensity = 1.1 * levels.neon * levels.pools;
        this.lamp.color.copy(this.blend.get('lampCool'));
        this.lamp.intensity = 20 * levels.lamp;
        this.pools.forEach(({ material, key, level, source }) => {
            material.color.copy(this.blend.get(key)).multiplyScalar(level * levels[source] * levels.pools);
        });
    }

    dispose() {
        this.pools.forEach(pool => pool.mesh.geometry.dispose());
        this.texture.dispose();
    }
}
