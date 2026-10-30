import * as THREE from 'three';
import type { MachiPalette } from './palette';
import { injectMachiSheen, MACHI_GLOSS, machiGlossFor, type MachiGloss } from './sheen';
import { injectMachiSnow, type MachiSnowUniforms } from './snow';

// src/components/visualizer/machi/engine/materials.ts
// 町景的材质：克制的卡通着色（MeshToonMaterial + 4 阶渐变图），自发光件（招牌、灯头、冰柜内光）用 MeshBasicMaterial
// 输出高于 1 的线性色给 bloom 一点余量。颜色都从调色板来，换主题时由 MachiColorBlend 插值过去再写回材质。
// 引擎一份 MachiMaterials（地面、天气、后处理用的），每个场景建自己的一份（场景拆掉时一起销毁），共用一个 ColorBlend。
// 卡通材质都注入了积雪（snow.ts），共用一组积雪 uniform。

/** 调色板摊平后的键：调色板里的单色键、三色条、8 个商品色，加上场景自己的颜色（art）。 */
export type MachiColorKey = string;

export const flattenMachiPalette = (palette: MachiPalette): Record<MachiColorKey, string> => {
    const flat: Record<string, string> = {};
    (Object.keys(palette) as (keyof MachiPalette)[]).forEach(key => {
        const value = palette[key];
        if (typeof value === 'string') flat[key] = value;
    });
    palette.brand.forEach((color, index) => { flat[`brand${index}`] = color; });
    palette.products.forEach((color, index) => { flat[`product${index}`] = color; });
    Object.entries(palette.art).forEach(([key, color]) => { flat[key] = color; });
    return flat;
};

/** 换主题时颜色的插值：每个键一对当前 / 目标色，按指数阻尼追过去（与镜台的 COLOR_DAMP_RATE 同一个做法）。 */
export class MachiColorBlend {
    private readonly current = new Map<MachiColorKey, THREE.Color>();
    private readonly target = new Map<MachiColorKey, THREE.Color>();
    private settled = true;

    constructor(palette: MachiPalette) {
        Object.entries(flattenMachiPalette(palette)).forEach(([key, value]) => {
            this.current.set(key, new THREE.Color(value));
            this.target.set(key, new THREE.Color(value));
        });
    }

    /** 新目标（换主题、换歌、换场景）。新出现的键（换了场景）直接取目标色，不从别处插值过来。 */
    setTarget(palette: MachiPalette, immediate = false) {
        Object.entries(flattenMachiPalette(palette)).forEach(([key, value]) => {
            const target = this.target.get(key) ?? new THREE.Color();
            target.set(value);
            this.target.set(key, target);
            if (immediate || !this.current.has(key)) this.current.set(key, target.clone());
        });
        this.settled = immediate;
    }

    /** 推进插值；返回这一步颜色有没有变。 */
    step(deltaSeconds: number, rate = 2.4): boolean {
        if (this.settled) return false;
        const k = 1 - Math.exp(-rate * deltaSeconds);
        let moving = false;
        this.current.forEach((color, key) => {
            const target = this.target.get(key)!;
            color.lerp(target, k);
            if (Math.abs(color.r - target.r) + Math.abs(color.g - target.g) + Math.abs(color.b - target.b) > 0.002) moving = true;
            else color.copy(target);
        });
        this.settled = !moving;
        return true;
    }

    /** 由环境推出来的颜色（天空、天光随时间与天气变）盖在调色板的同名键上；raw 读调色板本身的值。 */
    private readonly derived = new Map<MachiColorKey, THREE.Color>();

    setDerived(key: MachiColorKey, color: THREE.Color) {
        const held = this.derived.get(key);
        if (held) held.copy(color);
        else this.derived.set(key, color.clone());
    }

    raw(key: MachiColorKey): THREE.Color {
        return this.current.get(key) ?? this.current.get('concrete')!;
    }

    get(key: MachiColorKey): THREE.Color {
        return this.derived.get(key) ?? this.raw(key);
    }
}

/** 自发光件的规格：颜色键与亮度倍数（线性空间，> 1 才会被 bloom 轻轻带出光晕）。 */
export interface MachiGlowSpec {
    key: MachiColorKey;
    level: number;
}

/** 4 阶的卡通渐变：暗部不压死，亮部一刀切，避免塑料感的连续高光。 */
const createToonGradient = () => {
    const data = new Uint8Array([86, 146, 206, 255]);
    const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
};

export class MachiMaterials {
    readonly gradient = createToonGradient();
    private readonly toons = new Map<MachiColorKey, THREE.MeshToonMaterial>();
    private readonly glows = new Map<string, THREE.MeshBasicMaterial>();
    private readonly glowSpecs = new Map<string, MachiGlowSpec>();
    private readonly glowLevels = new Map<string, number>();
    /** 透明落地玻璃：不写深度，透过它能看到（也能描到）里面。 */
    readonly glass: THREE.MeshToonMaterial;
    /** 商品、瓶子、车身这类实例件：白底，颜色走 InstancedMesh 的实例色。 */
    readonly product: THREE.MeshToonMaterial;
    private readonly extra: THREE.Material[] = [];

    /** prefix 是材质名前缀：场景的材质带场景 id，调试时看得出是谁的。 */
    constructor(private readonly blend: MachiColorBlend, private readonly snow: MachiSnowUniforms, private readonly prefix = 'machi') {
        this.glass = new THREE.MeshToonMaterial({
            color: blend.get('glass'),
            gradientMap: this.gradient,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
        });
        this.glass.name = `${prefix}:glass`;
        this.snowy(this.glass, MACHI_GLOSS.glass);
        this.product = this.snowy(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: this.gradient }), MACHI_GLOSS.metal);
        this.product.name = `${prefix}:product`;
    }

    /** 给卡通材质注入积雪与高光（外面另建的卡通材质也可以用，比如车身）。gloss 只是 uniform，不分着色器程序。 */
    snowy<T extends THREE.MeshToonMaterial>(material: T, gloss: MachiGloss = MACHI_GLOSS.matte): T {
        material.onBeforeCompile = shader => {
            injectMachiSnow(shader, this.snow);
            injectMachiSheen(shader, this.snow, gloss);
        };
        material.customProgramCacheKey = () => 'machi-snow';
        return material;
    }

    /** 按调色板颜色键上色的卡通材质（'white' 是纯白，不跟主题走）。 */
    toon(key: MachiColorKey): THREE.MeshToonMaterial {
        let material = this.toons.get(key);
        if (!material) {
            material = this.snowy(new THREE.MeshToonMaterial({
                color: key === 'white' ? 0xffffff : this.blend.get(key),
                gradientMap: this.gradient,
            }), machiGlossFor(key));
            material.name = `${this.prefix}:${key}`;
            this.toons.set(key, material);
        }
        return material;
    }

    /** 场景登记自己的自发光件规格（建几何之前）。 */
    defineGlows(specs: Record<string, MachiGlowSpec>) {
        Object.entries(specs).forEach(([role, spec]) => this.glowSpecs.set(role, spec));
    }

    glow(role: string): THREE.MeshBasicMaterial {
        let material = this.glows.get(role);
        if (!material) {
            if (!this.glowSpecs.has(role)) throw new Error(`[Machi] glow role "${role}" is not defined`);
            material = new THREE.MeshBasicMaterial({ color: 0xffffff });
            material.name = `machi:glow:${role}`;
            this.glows.set(role, material);
            this.syncGlow(role, material);
        }
        return material;
    }

    /** 自发光件的亮度调制（闪烁、副歌加亮），1 是常态。 */
    setGlowLevel(role: string, level: number) {
        if (this.glowLevels.get(role) === level) return;
        this.glowLevels.set(role, level);
        const material = this.glows.get(role);
        if (material) this.syncGlow(role, material);
    }

    /** 外面另建的材质（招牌、天气）交给这里一起销毁。 */
    track<T extends THREE.Material>(material: T): T {
        this.extra.push(material);
        return material;
    }

    private syncGlow(role: string, material: THREE.MeshBasicMaterial) {
        const spec = this.glowSpecs.get(role)!;
        material.color.copy(this.blend.get(spec.key)).multiplyScalar(spec.level * (this.glowLevels.get(role) ?? 1));
    }

    /** 插值后的颜色写回所有材质。 */
    syncColors() {
        this.toons.forEach((material, key) => {
            if (key !== 'white') material.color.copy(this.blend.get(key));
        });
        this.glass.color.copy(this.blend.get('glass'));
        this.glows.forEach((material, role) => this.syncGlow(role, material));
    }

    dispose() {
        this.toons.forEach(material => material.dispose());
        this.glows.forEach(material => material.dispose());
        this.glass.dispose();
        this.product.dispose();
        this.extra.forEach(material => material.dispose());
        this.gradient.dispose();
    }
}
