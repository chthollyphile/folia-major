// src/components/visualizer/metaphor/metaphorShaders.ts
// 隐喻的着色器。画面分两步：
// 1. 墨场：字形和融球、装饰图形用加法混合画进一张半浮点的离屏图，三路各管一样——R 是墨、G 是网点的浓淡、B 是强调色的墨。
//    字形贴图有两个通道：紧的（轻微模糊，阈值一切就是字形）和宽的（大模糊，字周围的一团），所以字和融球挨近了会连在一起。
// 2. 显影：全屏一遍。先让流场把取样位置推歪（每秒 8 格地跳，像逐格动画，流场本身走得很慢），再对墨切阈值（阈值被噪点搅过，边缘是毛的），
//    阈值以下的那圈模糊变成半调网点，最后压上砂纸颗粒和杂点。纸墨对调、漫墨也在这里。
// 着色器里的平方、立方都写成相乘：负数的 pow 在 D3D 上是 NaN。

export const METAPHOR_GLYPH_VERTEX = /* glsl */ `
attribute vec2 aOffset;
attribute vec2 aTime;
attribute vec3 aMeta;
uniform float uTime;
uniform float uMelt;
uniform float uPop;
varying vec2 vUv;
varying vec2 vTime;
varying vec3 vMeta;

void main() {
    float dt = uTime - aTime.x;
    float on = step(0.0, dt);
    // 开唱的一下鼓起来，慢慢收回去；还没唱到的略小一点
    float scale = mix(0.94, 1.0 + uPop * 0.18 * exp(-max(dt, 0.0) * 2.2), on);
    vec3 p = position;
    // 化开：各自朝自己的方向散出去（不是往下淌）
    float away = aMeta.x * 6.2832;
    p.xy += vec2(cos(away), sin(away)) * uMelt * uMelt * (0.4 + fract(aMeta.x * 7.31) * 0.9) * aMeta.z;
    scale *= 1.0 + uMelt * 0.25;
    p.xy += aOffset * scale;
    vUv = uv;
    vTime = aTime;
    vMeta = aMeta;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const METAPHOR_GLYPH_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uReveal;
uniform float uMelt;
varying vec2 vUv;
varying vec2 vTime;
varying vec3 vMeta;

void main() {
    vec2 s = texture2D(uAtlas, vUv).rg;
    float dt = uTime - vTime.x;
    float on = step(0.0, dt);
    float age = max(dt, 0.0);
    // 墨凝出来：先是一团（宽通道），很快收紧成字形（紧通道）
    float set = on * (1.0 - exp(-age * 4.5));
    float bulge = on * exp(-age * 1.5);
    float keep = 1.0 - uMelt;
    float ink = s.r * set * keep * keep + s.g * (bulge * 1.25 + 0.3 * set + 0.9 * uMelt * set) * keep;
    // 没唱到的字只是一层网点的影子；唱过的字周围留一圈网点
    float tone = (s.r * (1.0 - set) * 0.85 + s.g * (0.3 + 0.45 * set)) * uReveal * keep;
    // 注记（结束时间是个很大的负数）：到时候直接出现，只有细的墨字，没有那一团和网点
    float note = step(vTime.y, -10000.0);
    ink = mix(ink, s.r * on * keep * keep * 1.12, note);
    tone *= 1.0 - note;
    gl_FragColor = vec4(ink * (1.0 - vMeta.y), tone, ink * vMeta.y, 1.0);
}
`;

export const METAPHOR_SHAPE_VERTEX = /* glsl */ `
attribute vec2 iPos;
attribute vec2 iScale;
attribute float iRot;
attribute vec3 iMix;
attribute float iShape;
attribute float iParam;
varying vec2 vQ;
varying vec3 vMix;
varying float vShape;
varying float vParam;
varying vec2 vScale;

void main() {
    // 圆弧那一格是正方的：sy 是线宽的倍数，不是半轴
    vec2 scale = iShape > 2.5 && iShape < 3.5 ? vec2(iScale.x) : iScale;
    vec2 o = position.xy * scale;
    float c = cos(iRot);
    float s = sin(iRot);
    o = vec2(o.x * c - o.y * s, o.x * s + o.y * c);
    vQ = position.xy;
    vMix = iMix;
    vShape = iShape;
    vParam = iParam;
    vScale = iScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + o, 0.0, 1.0);
}
`;

export const METAPHOR_SHAPE_FRAGMENT = /* glsl */ `
varying vec2 vQ;
varying vec3 vMix;
varying float vShape;
varying float vParam;
varying vec2 vScale;

// 线稿的线的半宽（世界单位），和 metaphorFigures.ts 的 STROKE 一致
const float STROKE = 0.016;

void main() {
    float r2 = dot(vQ, vQ);
    float core;
    float halo;
    if (vShape < 0.5) {
        // 融球：中间高、边上平滑落到 0，几个挨近了相加就连成一片
        float k = max(0.0, 1.0 - r2);
        core = k * k * k * 1.45;
        halo = k * k * 0.55;
        gl_FragColor = vec4(core * vMix.x, k * k * vMix.y * 0.6 + halo * (vMix.x + vMix.z), core * vMix.z, 1.0);
        return;
    }
    if (vShape < 1.5) {
        // 圆环：一道细的环带
        float band = abs(sqrt(r2) - 0.88);
        core = 1.0 - smoothstep(0.012, 0.03, band);
        halo = 1.0 - smoothstep(0.02, 0.12, band);
    } else if (vShape < 2.5) {
        // 细线：两头收一点；param 大于 0 时切成那么多段虚线
        core = 1.0 - smoothstep(0.96, 1.0, abs(vQ.x));
        if (vParam > 0.5) core *= step(fract((vQ.x * 0.5 + 0.5) * vParam + 0.25), 0.55);
        halo = 0.0;
    } else if (vShape < 3.5) {
        // 圆弧：线宽按世界单位算，不跟着半径变粗；只画转角两边 param × π 以内的那一段
        float d = abs(sqrt(r2) - 0.9) * vScale.x;
        float w = STROKE * vScale.y;
        float within = step(abs(atan(vQ.y, vQ.x)), vParam * 3.14159 + 0.001);
        core = (1.0 - smoothstep(w * 0.6, w * 1.6, d)) * within;
        halo = (1.0 - smoothstep(w, w * 6.0, d)) * within * (1.0 - min(1.0, vMix.x + vMix.z)) * 2.0;
    } else {
        // 波浪线：param 个半波，两头都落在零点上；到曲线的距离按斜率折算
        float phase = 1.5708 * vParam * (vQ.x + 1.0);
        float amp = vScale.y * 0.75;
        float slope = amp * cos(phase) * 1.5708 * vParam / vScale.x;
        float d = abs(vQ.y * vScale.y - amp * sin(phase)) / sqrt(1.0 + slope * slope);
        core = 1.0 - smoothstep(STROKE * 0.6, STROKE * 1.6, d);
        halo = 0.0;
    }
    gl_FragColor = vec4(core * vMix.x, core * vMix.y + halo * 0.35, core * vMix.z, 1.0);
}
`;

export const METAPHOR_DEVELOP_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const METAPHOR_DEVELOP_FRAGMENT = /* glsl */ `
uniform sampler2D uField;
uniform vec2 uRes;
uniform float uPixelRatio;
uniform float uTime;
uniform float uFlow;
uniform float uGrain;
uniform float uDot;
uniform float uAngle;
uniform float uFlood;
uniform float uInvert;
uniform float uSeed;
uniform float uSeeThrough;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform vec3 uTone;
varying vec2 vUv;

// 坐标是整像素、数值大：用这个不带 sin 的散列，便宜的那种在大坐标上会排出一列列竖纹
float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
    // CSS 像素：网点、颗粒的大小不跟着屏幕的像素密度变
    vec2 frag = vUv * uRes / uPixelRatio;
    float aspect = uRes.x / uRes.y;
    vec2 p = vec2(vUv.x * aspect, vUv.y);
    // 流场每秒 8 格，颗粒每秒 6 格
    float tq = floor(uTime * 8.0) / 8.0;
    float beat = floor(uTime * 6.0);

    // 流场：一层大的慢慢推，一层小的抖
    vec2 warp = (vec2(vnoise(p * 3.2 + vec2(0.0, tq * 0.16)), vnoise(p * 3.2 + vec2(17.3, -tq * 0.13))) - 0.5) * 0.024
        + (vec2(vnoise(p * 9.0 + vec2(tq * 0.3, 3.0)), vnoise(p * 9.0 + vec2(31.7, -tq * 0.27))) - 0.5) * 0.007;
    warp *= uFlow;
    warp.x /= aspect;
    vec2 uv = vUv + warp;
    vec4 field = texture2D(uField, uv);

    // 阈值被噪点搅过：墨的边缘像砂纸上蹭出来的
    float rough = (vnoise(frag * 0.45 + uSeed * 91.0) - 0.5) * 0.16 + (hash(floor(frag * 0.9) + uSeed * 13.0) - 0.5) * 0.08;
    float threshold = 0.5 + rough * uGrain;
    float inkField = field.r + uFlood;
    float inkEdge = max(fwidth(inkField), 0.0001) * 0.75;
    float ink = smoothstep(threshold - inkEdge, threshold + inkEdge, inkField);
    float accentEdge = max(fwidth(field.b), 0.0001) * 0.75;
    float accent = smoothstep(threshold - accentEdge, threshold + accentEdge, field.b);

    // 半调：阈值以下的那圈模糊、没唱到的字、网点云和四角的暗角，都画成大小不一的圆点
    vec2 centered = vUv - 0.5;
    float vignette = smoothstep(0.42, 1.0, length(centered) * 1.3);
    float tone = clamp(field.g * 0.9 + (field.r + field.b) * 0.5 + vignette * 0.3, 0.0, 1.0);
    float ca = cos(uAngle);
    float sa = sin(uAngle);
    vec2 grid = vec2(frag.x * ca - frag.y * sa, frag.x * sa + frag.y * ca) / uDot;
    // 最浓的地方圆点也只是刚好相连，留着格子间的纸，不糊成一片平的灰
    float radius = sqrt(tone) * 0.58;
    float soft = 0.9 / uDot;
    float dots = (1.0 - smoothstep(radius - soft, radius + soft, length(fract(grid) - 0.5))) * step(0.015, tone);

    vec3 paper = mix(uPaper, uInk, uInvert);
    vec3 inkColor = mix(uInk, uPaper, uInvert);
    vec3 color = mix(paper, mix(paper, uTone, 0.82), dots);
    color = mix(color, uAccent, accent);
    // 墨最后画：强调色融球漂到字上时，字压在它上面照样读得出来
    color = mix(color, inkColor, ink);

    // 画面四角的裁切标记：钉在屏幕上，不跟着镜头走
    vec2 edge = min(frag, uRes / uPixelRatio - frag);
    float mark = max(
        step(abs(edge.x - 18.0), 0.75) * step(18.0, edge.y) * step(edge.y, 34.0),
        step(abs(edge.y - 18.0), 0.75) * step(18.0, edge.x) * step(edge.x, 34.0));
    color = mix(color, inkColor, mark * 0.85);

    // 砂纸：细颗粒每格换一次，纸的斑驳不动，再撒一点杂点（纸上是墨色的，墨里是纸色的）
    float fine = hash(floor(frag / 1.4) + beat * 7.13 + uSeed * 3.0);
    float mottle = vnoise(frag * 0.12 + uSeed * 50.0);
    float speck = step(0.988, hash(floor(frag / 2.2) + beat * 3.7 + 0.5));
    color *= 1.0 + ((fine - 0.5) * 0.22 + (mottle - 0.5) * 0.1) * uGrain;
    color = mix(color, mix(inkColor, paper, ink), speck * 0.55 * min(uGrain, 1.5));

    // 播放页透明时纸不画：只留墨、强调色和网点（反相的镜头整个是实的）
    float alpha = mix(1.0, max(max(ink, accent), max(max(dots * 0.82, mark), uInvert)), uSeeThrough);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}
`;
