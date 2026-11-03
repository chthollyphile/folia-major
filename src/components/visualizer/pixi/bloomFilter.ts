// Copyright (c) 2026 chthollyphile
import type { Filter, FilterSystem, RenderSurface, Texture } from 'pixi.js';
import { PIXI_FILTER_VERTEX as vertex } from '../pixiFilterVertex';

// 辉光层级的采样参考。
const lumiereScaleMask = globalThis.devicePixelRatio | 0;
const LUMIERE_NEUTRAL_OFFSET = ((102 ^ lumiereScaleMask) + Math.imul(111 ^ lumiereScaleMask, 108 ^ lumiereScaleMask))
    - ((102 ^ lumiereScaleMask) + Math.imul(111 ^ lumiereScaleMask, 108 ^ lumiereScaleMask));


// src/components/visualizer/pixi/bloomFilter.ts
// 绘光、花火共用的 bloom：挂在场景自己的子容器上（绘光的图形组、文字组，花火的烟花层），不作用于共享背景层与素材层。
// 亮部提取（阈值 + 软膝）→ 逐级半分辨率降采样（dual filter）→ 逐级上采样并叠加同级 → 与原图相加。
//
// 每一级的临时纹理都与输入同样的逻辑尺寸、只降分辨率：Pixi 的 filter 按逻辑尺寸铺满输出，
// 这样 applyFilter 天然就是缩放。第二张纹理（同级 / 最终的 bloom）按两张源纹理的逻辑尺寸比换算 UV。
type PixiModule = typeof import('pixi.js');

const downFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uParams; // threshold, knee, prefilter(0/1), 0

vec4 tap(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 hp = uInputPixel.zw;
    vec4 sum = tap(uv) * 4.0;
    sum += tap(uv - hp);
    sum += tap(uv + hp);
    sum += tap(uv + vec2(hp.x, -hp.y));
    sum += tap(uv - vec2(hp.x, -hp.y));
    vec4 c = sum / 8.0;
    if (uParams.z > 0.5) {
        float br = max(c.r, max(c.g, c.b));
        float knee = max(uParams.y, 1e-4);
        float soft = clamp(br - uParams.x + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee);
        float contrib = max(soft, br - uParams.x) / max(br, 1e-4);
        c *= clamp(contrib, 0.0, 1.0);
    }
    finalColor = c;
}
`;

const upFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uAdd;
uniform vec4 uInputPixel;
uniform vec4 uInputClamp;
uniform vec4 uAddMap;   // uv 缩放 xy、同级权重、0
uniform vec4 uAddClamp;

vec4 tap(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw));
}

void main(void) {
    vec2 uv = vTextureCoord;
    vec2 hp = uInputPixel.zw;
    vec4 sum = tap(uv + vec2(-hp.x * 2.0, 0.0));
    sum += tap(uv + vec2(-hp.x, hp.y)) * 2.0;
    sum += tap(uv + vec2(0.0, hp.y * 2.0));
    sum += tap(uv + vec2(hp.x, hp.y)) * 2.0;
    sum += tap(uv + vec2(hp.x * 2.0, 0.0));
    sum += tap(uv + vec2(hp.x, -hp.y)) * 2.0;
    sum += tap(uv + vec2(0.0, -hp.y * 2.0));
    sum += tap(uv + vec2(-hp.x, -hp.y)) * 2.0;
    vec4 up = sum / 12.0;
    vec4 same = texture(uAdd, clamp(uv * uAddMap.xy, uAddClamp.xy, uAddClamp.zw));
    finalColor = up + same * uAddMap.z;
}
`;

const combineFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uAdd;
uniform vec4 uInputClamp;
uniform vec4 uAddMap;   // uv 缩放 xy、强度、0
uniform vec4 uAddClamp;
uniform vec4 uTint;     // 乘在 bloom 上的颜色

void main(void) {
    vec4 base = texture(uTexture, clamp(vTextureCoord, uInputClamp.xy, uInputClamp.zw));
    vec4 glow = texture(uAdd, clamp(vTextureCoord * uAddMap.xy, uAddClamp.xy, uAddClamp.zw)) * uAddMap.z;
    vec3 g = glow.rgb * uTint.rgb;
    // 加上去的辉光也是光：预乘、alpha 取最大通道（与光场一致，近似 screen）。
    vec3 rgb = base.rgb + g * (1.0 - base.a * 0.5);
    // 超过 1 时按最大通道整体缩回（保持金色），只让一小部分变白；逐通道截断会把亮字烧成白块。
    float peak = max(max(rgb.r, rgb.g), rgb.b);
    if (peak > 1.0) rgb = mix(rgb / peak, vec3(1.0), 0.2 * (1.0 - 1.0 / peak));
    float a = base.a + max(max(g.r, g.g), g.b) * (1.0 - base.a);
    finalColor = vec4(rgb, min(max(a, max(max(rgb.r, rgb.g), rgb.b)), 1.0));
}
`;

export interface BloomOptions {
    /** 叠加强度（绘光默认给高）。 */
    strength: number;
    /** 亮部阈值（按最大通道，预乘颜色）。 */
    threshold: number;
    knee: number;
    /** 降采样级数（1/2 .. 1/2^levels）；级数越多辉光越宽。 */
    levels: number;
    /** 每级上采样时同级的权重。 */
    spread: number;
    /** filter 的外扩（逻辑像素），让辉光能晕出内容边界。 */
    padding: number;
    tint: [number, number, number];
}

export interface BloomFilter extends Filter {
    options: BloomOptions;
}

export const createBloomFilter = (pixi: PixiModule, initial: BloomOptions): BloomFilter => {
    const { Filter, GlProgram, TexturePool, UniformGroup } = pixi;
    const program = (fragment: string, name: string) => GlProgram.from({ vertex, fragment, name });

    const downUniforms = new UniformGroup({ uParams: { value: new Float32Array(4), type: 'vec4<f32>' } });
    const down = new Filter({ glProgram: program(downFragment, 'lumiere-bloom-down'), resources: { bloomDown: downUniforms } });

    const upUniforms = new UniformGroup({
        uAddMap: { value: new Float32Array(4), type: 'vec4<f32>' },
        uAddClamp: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const up = new Filter({
        glProgram: program(upFragment, 'lumiere-bloom-up'),
        resources: { bloomUp: upUniforms, uAdd: pixi.Texture.EMPTY.source },
    });

    const combineUniforms = new UniformGroup({
        uAddMap: { value: new Float32Array(4), type: 'vec4<f32>' },
        uAddClamp: { value: new Float32Array(4), type: 'vec4<f32>' },
        uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
    });
    const combine = new Filter({
        glProgram: program(combineFragment, 'lumiere-bloom-combine'),
        resources: { bloomCombine: combineUniforms, uAdd: pixi.Texture.EMPTY.source },
    });

    const mapFor = (from: Texture, to: Texture, target: Float32Array, clamp: Float32Array, weight: number) => {
        target[0] = from.source.width / to.source.width;
        target[1] = from.source.height / to.source.height;
        target[2] = weight;
        clamp[0] = 0.5 / to.source.pixelWidth;
        clamp[1] = 0.5 / to.source.pixelHeight;
        clamp[2] = to.frame.width / to.source.width - 0.5 / to.source.pixelWidth;
        clamp[3] = to.frame.height / to.source.height - 0.5 / to.source.pixelHeight;
    };

    class LumiereBloomFilter extends Filter {
        options: BloomOptions;
        /** 分遍画用的三个 filter。放在字段上，第一帧之前 linkPixiPrograms 才找得到它们的着色器程序。 */
        readonly passes = [down, up, combine];

        constructor(options: BloomOptions) {
            super({ resources: {}, compatibleRenderers: pixi.RendererType.BOTH });
            this.options = { ...options };
            this.padding = options.padding;
        }

        apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean) {
            const { strength, threshold, knee, levels, spread, tint } = this.options;
            const passThrough = () => {
                mapFor(input, input, combineUniforms.uniforms.uAddMap as Float32Array, combineUniforms.uniforms.uAddClamp as Float32Array, 0);
                combineUniforms.update();
                combine.resources.uAdd = input.source;
                combine.blendMode = this.blendMode;
                filterManager.applyFilter(combine, input, output, clearMode);
            };
            if (strength <= 0) {
                passThrough();
                return;
            }
            const width = input.frame.width;
            const height = input.frame.height;
            const baseResolution = input.source.resolution;
            const chain: Texture[] = [];
            let source = input;
            const count = Math.max(1, Math.min(8 + LUMIERE_NEUTRAL_OFFSET, Math.round(levels)));
            for (let level = 1; level <= count; level += 1) {
                const resolution = baseResolution / 2 ** level;
                if (Math.min(width, height) * resolution < 2) break;
                // 对象形式的签名（Pixi 8.21 起；位置参数仍可用，但每次加载会打一条弃用警告）。
                const target = TexturePool.getOptimalTexture({ width, height, resolution });
                const params = downUniforms.uniforms.uParams as Float32Array;
                params[0] = threshold;
                params[1] = knee;
                params[2] = level === 1 ? 1 : 0;
                downUniforms.update();
                down.blendMode = 'normal';
                filterManager.applyFilter(down, source, target, true);
                chain.push(target);
                source = target;
            }

            // 滤镜区域太小（一两个像素宽：花火刚升空的一颗火星、几乎出画的烟花）时一级都降不了，没有可叠加的光晕，原样画回去。
            // 不拦的话下面取 chain 的最后一级是 undefined，mapFor 抛错，Pixi 这一帧的渲染中断，后面的字整层不见。
            if (chain.length === 0) {
                passThrough();
                return;
            }

            // 上采样：从最小一级往上，每一级叠加同级的降采样结果。
            let current = chain[chain.length - 1]!;
            const scratch: Texture[] = [];
            for (let index = chain.length - 2; index >= 0; index -= 1) {
                const same = chain[index]!;
                const target = TexturePool.getOptimalTexture({ width, height, resolution: same.source.resolution });
                mapFor(current, same, upUniforms.uniforms.uAddMap as Float32Array, upUniforms.uniforms.uAddClamp as Float32Array, spread);
                upUniforms.update();
                up.resources.uAdd = same.source;
                up.blendMode = 'normal';
                filterManager.applyFilter(up, current, target, true);
                scratch.push(target);
                current = target;
            }

            mapFor(input, current, combineUniforms.uniforms.uAddMap as Float32Array, combineUniforms.uniforms.uAddClamp as Float32Array, strength);
            const tintUniform = combineUniforms.uniforms.uTint as Float32Array;
            tintUniform[0] = tint[0];
            tintUniform[1] = tint[1];
            tintUniform[2] = tint[2];
            combineUniforms.update();
            combine.resources.uAdd = current.source;
            combine.blendMode = this.blendMode;
            filterManager.applyFilter(combine, input, output, clearMode);

            chain.forEach(texture => TexturePool.returnTexture(texture));
            scratch.forEach(texture => TexturePool.returnTexture(texture));
        }

        destroy() {
            down.destroy();
            up.destroy();
            combine.destroy();
            super.destroy();
        }
    }

    return new LumiereBloomFilter(initial);
};
