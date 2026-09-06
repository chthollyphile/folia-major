import * as React from 'react';
import { useLiquidGlassTuningStore } from '../../stores/useLiquidGlassTuningStore';

// src/components/shared/LiquidGlassFilter.tsx
// CSS 液态玻璃滤镜：feImage 位移贴图 + feDisplacementMap 做胶囊边缘折射，
// 再接高斯模糊与饱和度。通过 backdrop-filter: url(#id) 应用于元素——
// 折射的是元素身后「真实的 DOM/canvas 内容」（visualizer 画布、封面等），
// 由合成器驱动，无逐帧 JS。这是 vendored WebGL 渲染器做不到的场景
// （WebGL 只能折射喂给它的纹理，看不到 DOM 背后）。
// 仅 Chromium 系支持 backdrop-filter 的 url() 形式；不支持时返回 null，调用方回退纯 CSS blur。

const MAP_CACHE = new Map<string, string>();
const MAP_CACHE_LIMIT = 32;

export type LiquidGlassFilterOptions = {
    /** 位移后高斯模糊半径（px），近似原 backdrop-blur 强度 */
    blur?: number;
    /** 饱和度增益（feColorMatrix saturate） */
    saturation?: number;
    /** 边缘最大位移（px）——折射强度 */
    edgeDisplacement?: number;
    /** 边缘位移衰减带宽度（px） */
    edgeBand?: number;
    /** 玻璃形状：capsule（默认，r=h/2 的 Stadium）或 rounded（指定圆角半径的矩形） */
    shape?: 'capsule' | 'rounded';
    /** shape = 'rounded' 时的圆角半径（CSS px） */
    cornerRadius?: number;
    /** 边缘色散：RGB 三通道按不同位移强度分开折射再 screen 合并，滤镜链成本约 ×3 */
    dispersion?: boolean;
    /** 目标元素是否已挂载；条件渲染的面板（如时间线弹层）用 isOpen 传入，避免 RO 观察不到元素 */
    enabled?: boolean;
};

/** 生成位移贴图：R = x 位移，G = y 位移，128 = 不位移。
 *  距边缘越近位移越大（二次衰减），方向沿内法线，模拟玻璃边缘的透镜折射。
 *  B 通道烘焙倒角高度场（内部 255 → 边缘 0），供滤镜链的 feSpecularLighting
 *  生成玻璃 rim 高光；alpha 恒 255，避免 canvas PNG 导出 premultiply 干扰 R/G 编码。 */
function buildDisplacementMap(
    w: number,
    h: number,
    band0: number,
    maxDisplace: number,
    shape: 'capsule' | 'rounded',
    cornerRadius: number,
): string {
    const cacheKey = `${shape}|${w}x${h}|${band0}|${maxDisplace}|${cornerRadius}`;
    const cached = MAP_CACHE.get(cacheKey);
    if (cached) {
        // 真 LRU：命中即重插，布局动画期间高频复用的贴图不会被冷键挤掉
        MAP_CACHE.delete(cacheKey);
        MAP_CACHE.set(cacheKey, cached);
        return cached;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, w);
    canvas.height = Math.max(2, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(canvas.width, canvas.height);
    const data = img.data;
    const radius = shape === 'capsule'
        ? canvas.height / 2
        : Math.max(1, Math.min(cornerRadius, canvas.height / 2, canvas.width / 2));
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const straightHalfX = Math.max(0, canvas.width / 2 - radius);
    const straightHalfY = Math.max(0, canvas.height / 2 - radius);
    const scale = maxDisplace * 2; // feDisplacementMap 的 scale，编码留出溢出余量
    // 矮胶囊（h≈50px）上过宽的衰减带会让上下边缘位移侵吞整个高度
    const band = Math.min(band0, radius * 0.6);

    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            // 圆角矩形（含 Stadium 特例）SDF：dOut < 0 在内部，0 在边缘
            const qx = Math.abs(x - cx) - straightHalfX;
            const qy = Math.abs(y - cy) - straightHalfY;
            const outLen = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
            const dOut = outLen + Math.min(Math.max(qx, qy), 0) - radius;

            let dispX = 0;
            let dispY = 0;
            let height = 0;
            if (dOut <= 0) {
                // B 通道烘焙倒角高度场：内部平顶 1，边缘降到 0，供 feSpecularLighting
                // 生成 rim 高光。剖面取 1 - t²（与位移同剖面），法线在边缘带连续变化。
                if (dOut > -band) {
                    const t = 1 + dOut / band; // 边缘为 1，向内衰减到 0
                    const strength = maxDisplace * t * t;
                    height = 1 - t * t;
                    let nx = 0;
                    let ny = 0;
                    if (outLen > 0.0001) {
                        nx = Math.max(qx, 0) / outLen;
                        ny = Math.max(qy, 0) / outLen;
                    } else {
                        // 直段内部：法线取主导轴方向
                        if (Math.abs(qx) > Math.abs(qy)) nx = Math.sign(x - cx) || 1;
                        else ny = Math.sign(y - cy) || 1;
                    }
                    dispX = -nx * strength; // 负号 = 向内折射
                    dispY = -ny * strength;
                } else {
                    height = 1;
                }
            }

            const i = (y * canvas.width + x) * 4;
            data[i] = Math.max(0, Math.min(255, Math.round(128 + (127 * dispX) / maxDisplace)));
            data[i + 1] = Math.max(0, Math.min(255, Math.round(128 + (127 * dispY) / maxDisplace)));
            // 255 防止 canvas 导出 PNG 时 premultiply 抖动 R/G 编码
            data[i + 2] = Math.round(height * 255);
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const dataUrl = canvas.toDataURL();
    if (MAP_CACHE.size >= MAP_CACHE_LIMIT) {
        const first = MAP_CACHE.keys().next().value;
        if (first !== undefined) MAP_CACHE.delete(first);
    }
    MAP_CACHE.set(cacheKey, dataUrl);
    return dataUrl;
}

/** 当前浏览器是否支持 backdrop-filter 引用 SVG 滤镜（仅 Chromium 系）。
 *  设置卡用它决定显隐：不支持的浏览器玻璃本就不生效，连开关一起隐藏。 */
export const supportsSvgBackdropFilter = (): boolean => (
    typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('backdrop-filter', 'url(#liquid-glass-probe)')
);

/** 宽度量化的粒度：布局动画期间尺寸连续变化，按桶缓存贴图避免每帧重建 */
const WIDTH_BUCKET = 24;
const HEIGHT_BUCKET = 12;

export function useLiquidGlassFilter(
    targetRef: React.RefObject<HTMLElement | null>,
    options: LiquidGlassFilterOptions = {},
): { defs: React.ReactNode; backdropFilter: string | null } {
    const {
        blur = 3,
        saturation = 1.6,
        edgeDisplacement = 20,
        edgeBand = 18,
        shape = 'capsule',
        cornerRadius = 16,
        dispersion = false,
        enabled = true,
    } = options;
    const id = React.useId().replace(/[:]/g, '');
    const filterId = `liquid-glass-${id}`;
    const supportedRef = React.useRef<boolean | null>(null);
    const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
    // 液态玻璃总开关（设置卡可关）：关闭后 backdropFilter/defs 均为 null，
    // 表面回退到自身保留的 backdrop-blur-* 类（普通毛玻璃）。
    const glassEnabled = useLiquidGlassTuningStore(state => state.liquidGlassTuning.enabled);
    // rim 高光/描边总强度（设置卡滑杆）：0 = 不产出 rim 段；方向光与描边按比例派生
    const rimIntensity = useLiquidGlassTuningStore(state => state.liquidGlassTuning.rimIntensity);
    // 色散强度（设置卡滑杆）：RGB 通道位移差围绕 G 通道的展开倍率，1 = ±25% 分离
    const dispersionStrength = useLiquidGlassTuningStore(state => state.liquidGlassTuning.dispersionStrength);
    // 强度 0 与不开色散等价，直接走单路位移，省掉 ×3 的位移段
    const dispersionActive = dispersion && dispersionStrength > 0;
    // 通道位移差：默认 ±25%，随强度滑杆缩放
    const channelSpread = 0.25 * dispersionStrength;
    const activeEnabled = enabled && glassEnabled;
    // feImage 的实际绘制尺寸走 DOM 直写：贴图按量化桶生成（缓存友好），
    // 但绘制必须铺满元素真实边界，否则折射带会缩进控件里（比控件小一圈）。
    // 直写属性绕过 React 重渲染，布局动画期间每帧更新也只有一次属性赋值的开销。
    const feImageRef = React.useRef<SVGFEImageElement | null>(null);
    const filterRef = React.useRef<SVGFilterElement | null>(null);
    // 采样区外扩量：位移最多把采样点拉出边缘 maxDisplacement×(色散 1.25)，模糊再外扩 3σ。
    // 用 ref 让 RO 回调（effect 不随参数重建）始终读到当前值。
    const regionMarginRef = React.useRef(0);
    regionMarginRef.current = Math.ceil(edgeDisplacement * (dispersionActive ? 1 + channelSpread : 1) + blur * 3 + 2);
    // 贴图烘焙参数用：见下方 mapDataUrl 的 useMemo——贴图内容与该值无关，
    // 取 ref 只是为了不给烘焙链路引入随滑杆变化的依赖。
    const edgeDisplacementRef = React.useRef(edgeDisplacement);
    edgeDisplacementRef.current = edgeDisplacement;

    const syncFilterRegion = (w: number, h: number) => {
        const filterEl = filterRef.current;
        if (!filterEl) return;
        const m = regionMarginRef.current;
        filterEl.setAttribute('x', String(-m));
        filterEl.setAttribute('y', String(-m));
        filterEl.setAttribute('width', String(w + m * 2));
        filterEl.setAttribute('height', String(h + m * 2));
    };

    const supported = supportedRef.current ?? (supportedRef.current = supportsSvgBackdropFilter());

    React.useEffect(() => {
        const el = targetRef.current;
        if (!el || !supported || !activeEnabled) return;
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            // 必须用边框盒：contentRect 不含 padding/border，贴图会缩进控件一圈
            // （px-4 py-2 的胶囊 contentRect 会比可视边界小 32×16px）
            const borderBox = entry.borderBoxSize?.[0];
            const fallbackRect = entry.target.getBoundingClientRect();
            const actualW = Math.round(borderBox ? borderBox.inlineSize : fallbackRect.width);
            const actualH = Math.round(borderBox ? borderBox.blockSize : fallbackRect.height);
            if (actualW < 4 || actualH < 4) return;
            const feImage = feImageRef.current;
            if (feImage) {
                feImage.setAttribute('width', String(actualW));
                feImage.setAttribute('height', String(actualH));
            }
            syncFilterRegion(actualW, actualH);
            const next = {
                w: Math.round(actualW / WIDTH_BUCKET) * WIDTH_BUCKET,
                h: Math.round(actualH / HEIGHT_BUCKET) * HEIGHT_BUCKET,
            };
            setSize(prev => (
                prev && prev.w === next.w && prev.h === next.h ? prev : next
            ));
            // 桶变化时 React 提交会用桶尺寸覆盖 feImage 的宽高，而 RO 不会再触发；
            // 下一帧再直写一次精确尺寸兜底（动画期间最多偏差一帧）。
            requestAnimationFrame(() => {
                const feImage = feImageRef.current;
                if (!feImage) return;
                feImage.setAttribute('width', String(actualW));
                feImage.setAttribute('height', String(actualH));
                syncFilterRegion(actualW, actualH);
            });
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [targetRef, supported, activeEnabled]);

    const mapDataUrl = React.useMemo(() => {
        if (!supported || !size) return null;
        // 贴图内容与位移强度无关：编码时 maxDisplace 在 R 通道里被约掉
        // （R = 128 − 127·nx·t²），折射强度完全由 feDisplacementMap 的 scale 实时施加。
        // 因此不把 edgeDisplacement 列入依赖——拖折射滑杆时不重烘焙贴图 +
        // PNG 编码（大表面单次数十 ms，逐 tick 重建会卡滑杆）。
        return buildDisplacementMap(size.w, size.h, edgeBand, edgeDisplacementRef.current, shape, cornerRadius);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supported, size, edgeBand, shape, cornerRadius]);

    const backdropFilter = activeEnabled && supported && mapDataUrl
        ? `url(#${filterId})`
        : null;
    const regionMargin = regionMarginRef.current;

    const defs = (activeEnabled && supported && mapDataUrl && size) ? (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
            <defs>
                <filter
                    id={filterId}
                    filterUnits="userSpaceOnUse"
                    x={-regionMargin}
                    y={-regionMargin}
                    width={size.w + regionMargin * 2}
                    height={size.h + regionMargin * 2}
                    colorInterpolationFilters="sRGB"
                    ref={filterRef}
                >
                    <feImage
                        ref={feImageRef}
                        href={mapDataUrl}
                        x="0"
                        y="0"
                        width={size.w}
                        height={size.h}
                        preserveAspectRatio="none"
                        result="map"
                    />
                    {/* 位移必须在模糊之前作用于清晰内容：重磨砂会把位移抹成不可见。
                        代价是玻璃整体偏透（blur 8 而非原 backdrop-blur-xl 的 24），
                        可读性主要靠胶囊自身的 bg tint 兜底。 */}
                    {/*
                        边缘色散：同一张贴图跑三次位移（蓝通道偏折最强、红最弱，符合
                        玻璃色差的物理方向），各自用 feColorMatrix 掏出单通道后 screen
                        合并。不用三张贴图，缓存与 feImage 成本不变，只多两次位移。
                        通道位移差由设置卡 dispersionStrength 缩放（0 视同关闭，走单路）。
                    */}
                    {dispersionActive ? (
                        <>
                            <feDisplacementMap
                                in="SourceGraphic"
                                in2="map"
                                scale={edgeDisplacement * 2 * (1 - channelSpread)}
                                xChannelSelector="R"
                                yChannelSelector="G"
                                result="dispR"
                            />
                            <feColorMatrix
                                in="dispR"
                                type="matrix"
                                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                                result="chR"
                            />
                            <feDisplacementMap
                                in="SourceGraphic"
                                in2="map"
                                scale={edgeDisplacement * 2}
                                xChannelSelector="R"
                                yChannelSelector="G"
                                result="dispG"
                            />
                            <feColorMatrix
                                in="dispG"
                                type="matrix"
                                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                                result="chG"
                            />
                            <feDisplacementMap
                                in="SourceGraphic"
                                in2="map"
                                scale={edgeDisplacement * 2 * (1 + channelSpread)}
                                xChannelSelector="R"
                                yChannelSelector="G"
                                result="dispB"
                            />
                            <feColorMatrix
                                in="dispB"
                                type="matrix"
                                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                                result="chB"
                            />
                            <feBlend in="chR" in2="chG" mode="screen" result="chRG" />
                            <feBlend in="chRG" in2="chB" mode="screen" result="displaced" />
                        </>
                    ) : (
                        <feDisplacementMap
                            in="SourceGraphic"
                            in2="map"
                            scale={edgeDisplacement * 2}
                            xChannelSelector="R"
                            yChannelSelector="G"
                            result="displaced"
                        />
                    )}
                    <feGaussianBlur in="displaced" stdDeviation={blur} result="blurred" />
                    <feColorMatrix in="blurred" type="saturate" values={String(saturation)} result="toned" />
                    {/*
                        玻璃 rim 高光：位移贴图 B 通道烘焙了倒角高度场（内部平、边缘降到 0），
                        feSpecularLighting 用左上方 distant light 在倒角斜面上打出方向性高光
                        （顶边亮、底边暗，玻璃厚度感）；再叠一圈贴边白色描边补齐右下侧。
                        两层都用 rimMask（高度反转 = 边缘带）裁进边缘，避免平顶区被均匀洗白。
                        强度由设置卡 rimIntensity 驱动（描边取 0.9×、方向光取 4×），
                        0 时整段不产出，滤镜链退回 位移→模糊→饱和。
                    */}
                    {rimIntensity > 0 && (
                        <>
                            <feColorMatrix
                                in="map"
                                type="matrix"
                                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"
                                result="bump"
                            />
                            <feColorMatrix
                                in="map"
                                type="matrix"
                                values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 -1 1 0"
                                result="rimMask"
                            />
                            <feSpecularLighting
                                in="bump"
                                surfaceScale={3}
                                specularConstant={Math.round(rimIntensity * 4 * 100) / 100}
                                specularExponent={12}
                                lightingColor="#ffffff"
                                result="rimSpec"
                            >
                                <feDistantLight azimuth={225} elevation={60} />
                            </feSpecularLighting>
                            <feComposite in="rimSpec" in2="rimMask" operator="in" result="rimDirectional" />
                            {/* 描边 mask 做 gamma 压缩（t²→t⁶），收紧到贴边细线；
                                指数不能太大，1px 硬边在圆角处会出锯齿感 */}
                            <feComponentTransfer in="rimMask" result="rimRingMask">
                                <feFuncA type="gamma" amplitude={1} exponent={3} offset={0} />
                            </feComponentTransfer>
                            <feFlood
                                floodColor="#ffffff"
                                floodOpacity={Math.round(rimIntensity * 0.75 * 100) / 100}
                                result="rimFlood"
                            />
                            <feComposite in="rimFlood" in2="rimRingMask" operator="in" result="rimRing" />
                            {/*
                                底边内阴影：同一个高度场换一盏正下方低角度光，
                                只有朝下的倒角斜面（底边）会被点亮成 mask；黑色 flood
                                "in" 进去后对底色 multiply——半透明黑 multiply = 按 mask
                                比例压暗背景，玻璃底边出厚度。暗缘在浅色主题的白底上同样成立。
                            */}
                            <feSpecularLighting
                                in="bump"
                                surfaceScale={3}
                                specularConstant={1}
                                specularExponent={5}
                                lightingColor="#ffffff"
                                result="rimBottomRaw"
                            >
                                <feDistantLight azimuth={90} elevation={20} />
                            </feSpecularLighting>
                            <feComposite in="rimBottomRaw" in2="rimMask" operator="in" result="rimBottomCut" />
                            <feFlood
                                floodColor="#000000"
                                floodOpacity={Math.round(rimIntensity * 6 * 100) / 100}
                                result="rimShadowFlood"
                            />
                            <feComposite in="rimShadowFlood" in2="rimBottomCut" operator="in" result="rimShadow" />
                            <feBlend in="rimShadow" in2="toned" mode="multiply" result="tonedShaded" />
                        </>
                    )}
                    {/* 注意：backdrop-filter 路径下 Chromium 只渲染 feMerge 的第一个节点，
                        这里必须用 feComposite over 链式合并（语义等价）。
                        rimIntensity = 0 时不产出 rim 段，饱和度即滤镜输出。 */}
                    {rimIntensity > 0 ? (
                        <>
                            <feComposite in="rimRing" in2="rimDirectional" operator="over" result="rimAll" />
                            <feComposite in="rimAll" in2="tonedShaded" operator="over" />
                        </>
                    ) : null}
                </filter>
            </defs>
        </svg>
    ) : null;

    return { defs, backdropFilter };
}
