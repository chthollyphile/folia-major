// src/components/visualizer/metaphor/metaphorShaders.ts
// 隐喻的着色器。画面分两步：
// 1. 墨场：字形和融球、装饰图形用加法混合画进一张半浮点的离屏图，三路各管一样——R 是墨、G 是网点的浓淡、B 是强调色的墨。
//    字形贴图有两个通道：紧的（轻微模糊，阈值一切就是字形）和宽的（大模糊，字周围的一团），所以字和融球挨近了会连在一起。
// 2. 显影：全屏一遍。先让流场把取样位置推歪（每秒 8 格地跳，像逐格动画，流场本身走得很慢），再对墨切阈值（阈值被噪点搅过，边缘是毛的），
//    阈值以下的那圈模糊变成半调网点，最后压上砂纸颗粒和杂点。纸墨对调、漫墨也在这里。
// 墨场还有第二张图（uTint，多目标渲染的第二个输出）：强调色的墨各是什么颜色——rgb 是颜色乘墨量、a 是墨量，显影时相除得到那一处的颜色。
//    关键字各有各的颜色（主题的 wordColors），强调色融球是主题的强调色；几样叠在一起时按墨量混。
// 着色器里的平方、立方都写成相乘：负数的 pow 在 D3D 上是 NaN。

export const METAPHOR_GLYPH_VERTEX = /* glsl */ `
attribute vec2 aOffset;
attribute vec2 aTime;
attribute vec3 aMeta;
attribute vec3 aTint;
uniform float uTime;
uniform float uMelt;
uniform float uPop;
varying vec2 vUv;
varying vec2 vTime;
varying vec3 vMeta;
varying vec2 vWorld;
varying vec2 vQuad;
varying vec3 vTint;

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
    vTint = aTint;
    vWorld = (modelMatrix * vec4(p, 1.0)).xy;
    // 这一格里的位置（-1..1）：四个角按左下、右下、右上、左上的顺序排
    int corner = gl_VertexID - (gl_VertexID / 4) * 4;
    vQuad = vec2(corner == 0 || corner == 3 ? -1.0 : 1.0, corner < 2 ? -1.0 : 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const METAPHOR_GLYPH_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uReveal;
uniform float uMelt;
uniform float uShakeTime;
uniform float uWobble;
varying vec2 vUv;
varying vec2 vTime;
varying vec3 vMeta;
varying vec2 vWorld;
varying vec2 vQuad;
varying vec3 vTint;
layout(location = 1) out highp vec4 outTint;

// 注记的字比线细，抖得比线小一点，不然笔画会断
const float NOTE_SHAKE = 0.6;
// 注记周围那圈网点往外探多远（世界单位）。字本身的那团模糊在画面上只有一两个像素，比一颗网点还小，得往外多取几下
const float NOTE_FRINGE = 0.05;

void main() {
    // 注记（结束时间是个很大的负数）和线稿是同一支笔写的：用线稿那张世界位移场把取样位置推歪（和 METAPHOR_SHAPE_FRAGMENT 里的是同一个式子）。
    float note = step(vTime.y, -10000.0);
    vec2 w = vWorld;
    vec2 shake = vec2(sin(w.y * 1.7 + uShakeTime * 0.35) + sin(w.x * 0.9 - uShakeTime * 0.2), sin(w.x * 1.3 - uShakeTime * 0.3) + sin(w.y * 1.1 + uShakeTime * 0.25)) * 0.5
        + 0.32 * vec2(sin(w.y * 7.1 + w.x * 2.3 + uShakeTime * 0.6), sin(w.x * 6.3 - w.y * 1.9 - uShakeTime * 0.5))
        + 0.12 * vec2(sin(w.y * 37.0 + w.x * 17.0) + sin(w.x * 53.0), sin(w.x * 41.0 - w.y * 13.0) + sin(w.y * 59.0));
    shake *= uWobble * NOTE_SHAKE * note;
    // 世界里的位移换成贴图坐标的位移：用屏幕上相邻像素的差解出来，字转了角度也对
    vec2 wx = dFdx(vWorld);
    vec2 wy = dFdy(vWorld);
    float det = wx.x * wy.y - wx.y * wy.x;
    float inv = abs(det) > 1e-12 ? 1.0 / det : 0.0;
    vec2 ux = dFdx(vUv);
    vec2 uy = dFdy(vUv);
    vec2 qx = dFdx(vQuad);
    vec2 qy = dFdy(vQuad);
    vec2 step2 = vec2(shake.x * wy.y - shake.y * wy.x, shake.y * wx.x - shake.x * wx.y) * inv;
    vec2 uv = vUv + ux * step2.x + uy * step2.y;
    vec2 s = texture2D(uAtlas, uv).rg;
    float fringe = 0.0;
    if (note > 0.5) {
        // 绕一圈取六下宽通道，取最浓的：字周围就有了和线两边一样宽的一圈。探出这一格的不算（那边是图集里别的字）
        for (int i = 0; i < 6; i++) {
            float a = float(i) * 1.0472 + 0.3;
            vec2 o = vec2(cos(a), sin(a)) * NOTE_FRINGE;
            vec2 k = vec2(o.x * wy.y - o.y * wy.x, o.y * wx.x - o.x * wx.y) * inv;
            vec2 q = vQuad + qx * k.x + qy * k.y;
            float inside = step(max(abs(q.x), abs(q.y)), 1.0);
            fringe = max(fringe, textureLod(uAtlas, uv + ux * k.x + uy * k.y, 0.0).g * inside);
        }
    }
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
    // 注记到时候直接出现：细的墨字，没有那一团；字周围留一圈淡的网点，和线两边的毛边是一回事
    ink = mix(ink, s.r * on * keep * keep * 1.12, note);
    tone = mix(tone, min(0.55, max(s.g, fringe) * 1.6) * on * keep, note);
    gl_FragColor = vec4(ink * (1.0 - vMeta.y), tone, ink * vMeta.y, 1.0);
    outTint = vec4(vTint * (ink * vMeta.y), ink * vMeta.y);
}
`;

export const METAPHOR_SHAPE_VERTEX = /* glsl */ `
attribute vec2 iPos;
attribute vec2 iScale;
attribute float iRot;
attribute vec3 iMix;
attribute float iShape;
attribute float iParam;
varying vec2 vL;
varying vec2 vWorld;
varying vec2 vTurn;
varying vec3 vMix;
varying float vShape;
varying float vParam;
varying vec2 vScale;

// 每一格四周多留的边（世界单位）：给抖动和线两边那圈网点留地方
const float MARGIN = 0.2;

void main() {
    // 圆弧那一格是正方的：sy 是线宽的倍数，不是半轴
    vec2 scale = iShape > 2.5 && iShape < 3.5 ? vec2(iScale.x) : iScale;
    vec2 local = position.xy * (scale + MARGIN);
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 o = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
    vL = local;
    vWorld = iPos + o;
    vTurn = vec2(c, s);
    vMix = iMix;
    vShape = iShape;
    vParam = iParam;
    vScale = iScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + o, 0.0, 1.0);
}
`;

export const METAPHOR_SHAPE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uWobble;
uniform vec3 uAccent;
layout(location = 1) out highp vec4 outTint;
varying vec2 vL;
varying vec2 vWorld;
varying vec2 vTurn;
varying vec3 vMix;
varying float vShape;
varying float vParam;
varying vec2 vScale;

// 线稿的线的半宽（世界单位），和 metaphorFigures.ts 的 STROKE 一致
const float STROKE = 0.016;
// 线两边那圈网点有多宽
const float FRINGE = 0.11;

void main() {
    // 手抖：整个世界共用一张位移场（大的慢慢晃、中的、细碎的三层），同一个地方的线和点挪得一样，接头不会散开。
    // 细碎的那层不随时间动：它是纸的毛糙，线的边缘靠它变毛。
    vec2 w = vWorld;
    vec2 shake = vec2(sin(w.y * 1.7 + uTime * 0.35) + sin(w.x * 0.9 - uTime * 0.2), sin(w.x * 1.3 - uTime * 0.3) + sin(w.y * 1.1 + uTime * 0.25)) * 0.5
        + 0.32 * vec2(sin(w.y * 7.1 + w.x * 2.3 + uTime * 0.6), sin(w.x * 6.3 - w.y * 1.9 - uTime * 0.5))
        + 0.12 * vec2(sin(w.y * 37.0 + w.x * 17.0) + sin(w.x * 53.0), sin(w.x * 41.0 - w.y * 13.0) + sin(w.y * 59.0));
    shake *= uWobble;
    // 位移场是世界方向的，转回这一格自己的方向
    vec2 L = vL + vec2(shake.x * vTurn.x + shake.y * vTurn.y, shake.y * vTurn.x - shake.x * vTurn.y);
    float inked = min(1.0, vMix.x + vMix.z);
    float core;
    float halo;
    if (vShape < 0.5) {
        // 融球：中间高、边上平滑落到 0，几个挨近了相加就连成一片
        vec2 q = L / vScale;
        float k = max(0.0, 1.0 - dot(q, q));
        core = k * k * k * 1.45;
        halo = k * k * 0.55;
        gl_FragColor = vec4(core * vMix.x, k * k * vMix.y * 0.6 + halo * (vMix.x + vMix.z), core * vMix.z, 1.0);
        outTint = vec4(uAccent * (core * vMix.z), core * vMix.z);
        return;
    }
    if (vShape < 1.5) {
        // 圆环：一道细的环带
        float band = abs(length(L / vScale) - 0.88);
        core = 1.0 - smoothstep(0.012, 0.03, band);
        halo = 1.0 - smoothstep(0.02, 0.12, band);
        gl_FragColor = vec4(core * vMix.x, core * vMix.y + halo * 0.35, core * vMix.z, 1.0);
        outTint = vec4(uAccent * (core * vMix.z), core * vMix.z);
        return;
    }
    // 细线、圆弧、波浪线：先算到线的中心有多远（d）和线的半宽（reach）
    float d;
    float reach = STROKE;
    float cut = 1.0;
    if (vShape < 2.5) {
        // 细线（也是版面里的色带）：一个长方形；param 大于 0 时切成那么多段虚线
        reach = vScale.y;
        d = max(abs(L.y), abs(L.x) - vScale.x + reach);
        if (vParam > 0.5) cut = step(fract((L.x / vScale.x * 0.5 + 0.5) * vParam + 0.25), 0.55);
    } else if (vShape < 3.5) {
        // 圆弧：线宽按世界单位算，不跟着半径变粗；只画转角两边 param × π 以内的那一段
        reach = STROKE * vScale.y;
        d = abs(length(L) - 0.9 * vScale.x);
        cut = step(abs(atan(L.y, L.x)), vParam * 3.14159 + 0.001);
    } else {
        // 波浪线：param 个半波，两头都落在零点上；到曲线的距离按斜率折算
        float phase = 1.5708 * vParam * (L.x / vScale.x + 1.0);
        float amp = vScale.y * 0.75;
        float slope = amp * cos(phase) * 1.5708 * vParam / vScale.x;
        d = abs(L.y - amp * sin(phase)) / sqrt(1.0 + slope * slope);
        cut = step(abs(L.x), vScale.x);
    }
    // 线的边是一道缓坡，不是一刀切：显影时阈值被噪点搅过，缓坡上切出来的边才是毛的
    float soft = min(reach, STROKE);
    core = (1.0 - smoothstep(reach - soft * 0.8, reach + soft * 1.4, d)) * cut;
    // 墨线两边一圈网点：线不是干干净净浮在纸上的
    halo = (1.0 - smoothstep(reach, reach + FRINGE, d)) * cut * max(inked * 0.55, vMix.y * 0.4);
    gl_FragColor = vec4(core * vMix.x, core * vMix.y + halo, core * vMix.z, 1.0);
    outTint = vec4(uAccent * (core * vMix.z), core * vMix.z);
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
uniform sampler2D uTint;
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
    // 这一处强调色的墨是什么颜色（关键字各有各的）；没有墨的地方用主题的强调色
    vec4 tint = texture2D(uTint, uv);
    vec3 accentColor = tint.a > 0.002 ? clamp(tint.rgb / tint.a, 0.0, 1.0) : uAccent;

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
    color = mix(color, accentColor, accent);
    // 强调色融球盖着还没唱到的字时：字的网点影子压在它上面，照样看得见
    color = mix(color, mix(accentColor, inkColor, 0.4), dots * accent * smoothstep(0.85, 1.0, field.g));
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
