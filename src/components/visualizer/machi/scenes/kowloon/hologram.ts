import * as THREE from 'three';
import type { Line } from '../../../../../types';
import type { MachiBoardTarget } from '../../engine/director';
import type { MachiMaterials } from '../../engine/materials';
import { context2d, createCanvas, fitFont, fontSpec, wrapText, type MachiFont } from '../../engine/signRaster';

// src/components/visualizer/machi/scenes/kowloon/hologram.ts
// 巷子里的全息投影：地上一台投影机往上打一束淡淡的光，光束顶上浮着一块半透明的面板，写下一句（没有下一句时
// 写这一句的译文，曲名卡时写曲名与歌手）。加色混合、不写深度：扫描线、往上走的亮带、一圈细框、偶尔的闪烁，
// 换字时横带错位一下。白天被日光冲淡。

export interface KowloonHologramText {
    label: string;
    text: string;
}

/** 面板写什么：下一句；没有下一句时用这一句的译文；曲名卡时是曲名与歌手。 */
export const resolveKowloonHologramText = (target: MachiBoardTarget, lines: readonly Line[], song: { title: string; artist: string }): KowloonHologramText => {
    const title = song.title || 'KOWLOON';
    if (target.kind === 'line') {
        const next = lines.slice(target.index + 1).find(line => line.fullText.trim());
        if (next) return { label: 'NEXT', text: next.fullText.trim() };
        const translation = lines[target.index]?.translation?.trim();
        if (translation) return { label: 'TRANSLATION', text: translation };
    }
    return { label: 'NOW PLAYING', text: song.artist ? `${title} — ${song.artist}` : title };
};

const TEXTURE = { width: 1024, height: 376 };
/** 换字时的错位持续多久（秒）。 */
const SWITCH_SECONDS = 0.35;

const PANEL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PANEL_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uTime;
uniform float uLevel;
uniform float uGlitch;
uniform float uAspect;
varying vec2 vUv;
float hHash(float n) { return fract(sin(n * 91.7) * 43758.5453); }
void main() {
    vec2 uv = vUv;
    // 换字时几条横带错开。
    float band = floor(uv.y * 26.0);
    float tear = hHash(band + floor(uTime * 24.0) * 3.1);
    uv.x += (tear - 0.5) * 0.06 * uGlitch * step(0.55, tear);
    float text = texture2D(uMap, uv).r;
    // 扫描线、往上走的一道亮带、细框与四角的折角。
    float scan = 0.82 + 0.18 * sin(vUv.y * 190.0 - uTime * 8.0);
    // 负数的 pow 在 D3D 上是 NaN（会被 bloom 晕满全屏），平方都写成相乘。
    float sweepAt = (fract(vUv.y - uTime * 0.22) - 0.5) * 7.0;
    float sweep = exp(-sweepAt * sweepAt) * 0.35;
    vec2 edge = min(vUv, 1.0 - vUv) * vec2(uAspect, 1.0);
    float frame = 1.0 - smoothstep(0.006, 0.016, min(edge.x, edge.y));
    float corner = step(min(edge.x, edge.y), 0.035) * step(max(edge.x, edge.y), 0.12);
    float fill = 0.07 + 0.06 * (1.0 - vUv.y);
    float flicker = 0.9 + 0.1 * hHash(floor(uTime * 14.0));
    float intensity = (text * 1.35 + frame * 0.5 + corner * 0.6 + fill) * scan * flicker + sweep * (0.15 + text * 0.4);
    gl_FragColor = vec4(uColor * intensity * uLevel * (1.0 - 0.4 * uGlitch), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uTime;
varying vec2 vUv;
void main() {
    // 光束：越往上越淡，中间亮两边淡，几条往上流的细纹。
    float across = max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0);
    float streak = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 1.3) * sin(vUv.y * 9.0 - uTime * 3.0);
    float alpha = pow(across, 1.5) * (0.35 + 0.65 * (1.0 - vUv.y)) * streak;
    gl_FragColor = vec4(uColor * alpha * 0.3 * uLevel, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const additive = (material: THREE.ShaderMaterial) => {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    return material;
};

export class KowloonHologram {
    readonly group = new THREE.Group();
    private readonly canvas = createCanvas(TEXTURE.width, TEXTURE.height);
    private readonly texture: THREE.CanvasTexture;
    private readonly panel: THREE.ShaderMaterial;
    private readonly beam: THREE.ShaderMaterial;
    private readonly geometries: THREE.BufferGeometry[] = [];
    private key = '';
    private switchElapsed = SWITCH_SECONDS;
    private pending: { text: KowloonHologramText; font: MachiFont } | null = null;

    /** base 是投影机镜头的位置，panel 是面板中心（在镜头正上方）；面板绕 y 转 rotationY 朝向镜头。 */
    constructor(materials: MachiMaterials, base: THREE.Vector3, panel: { position: THREE.Vector3; width: number; height: number; rotationY: number }) {
        this.group.name = 'Hologram';
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.NoColorSpace;
        this.texture.anisotropy = 4;
        this.panel = materials.track(additive(new THREE.ShaderMaterial({
            vertexShader: PANEL_VERTEX,
            fragmentShader: PANEL_FRAGMENT,
            uniforms: {
                uMap: { value: this.texture },
                uColor: { value: new THREE.Color() },
                uTime: { value: 0 },
                uLevel: { value: 1 },
                uGlitch: { value: 0 },
                uAspect: { value: panel.width / panel.height },
            },
        })));
        this.panel.name = 'machi:glow:hologram';
        const panelGeometry = new THREE.PlaneGeometry(panel.width, panel.height);
        const panelMesh = new THREE.Mesh(panelGeometry, this.panel);
        panelMesh.name = 'Hologram/panel';
        panelMesh.position.copy(panel.position);
        panelMesh.rotation.y = panel.rotationY;
        panelMesh.renderOrder = 4;
        // 光束：从镜头到面板下沿的一片梯形（两片交叉，从哪个角度看都有）。
        this.beam = materials.track(additive(new THREE.ShaderMaterial({
            vertexShader: PANEL_VERTEX,
            fragmentShader: BEAM_FRAGMENT,
            uniforms: { uColor: { value: new THREE.Color() }, uLevel: { value: 1 }, uTime: { value: 0 } },
        })));
        const top = panel.position.y - panel.height / 2;
        const beamGeometry = new THREE.BufferGeometry();
        const half = panel.width / 2;
        const lens = 0.08;
        const rise = top - base.y;
        beamGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
            -lens, 0, 0, lens, 0, 0, half, rise, 0, -half, rise, 0,
        ], 3));
        beamGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        beamGeometry.setIndex([0, 1, 2, 0, 2, 3]);
        const beamMesh = new THREE.Mesh(beamGeometry, this.beam);
        beamMesh.name = 'Hologram/beam';
        beamMesh.position.copy(base);
        beamMesh.rotation.y = panel.rotationY;
        beamMesh.renderOrder = 3;
        this.geometries.push(panelGeometry, beamGeometry);
        this.group.add(beamMesh, panelMesh);
    }

    /** 换字：内容一样就不重画；immediate 时不做错位。 */
    setText(text: KowloonHologramText, font: MachiFont, immediate: boolean) {
        const key = `${text.label}|${text.text}|${font.stack}|${font.weight}`;
        if (key === this.key) return;
        this.key = key;
        if (immediate) {
            this.paint(text, font);
            this.switchElapsed = SWITCH_SECONDS;
            this.pending = null;
        } else {
            this.pending = { text, font };
            this.switchElapsed = 0;
        }
    }

    /** 内容作废（换主题、换字体）：下次 setText 一定重画。 */
    invalidate() {
        this.key = '';
    }

    private paint(text: KowloonHologramText, font: MachiFont) {
        const context = context2d(this.canvas);
        const { width, height } = this.canvas;
        context.clearRect(0, 0, width, height);
        context.fillStyle = '#000000';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#ffffff';
        context.textBaseline = 'middle';
        context.textAlign = 'left';
        // 左上角一行小标签，下面一到两行字。
        context.font = fontSpec({ stack: 'ui-monospace, "Cascadia Mono", Consolas, monospace', weight: 700 }, height * 0.1);
        context.globalAlpha = 0.75;
        context.fillText(`▸ ${text.label}`, width * 0.05, height * 0.14);
        context.globalAlpha = 1;
        context.textAlign = 'center';
        const maxWidth = width * 0.88;
        let px = height * 0.3;
        context.font = fontSpec(font, px);
        let rows = wrapText(context, text.text, maxWidth, 2);
        if (rows.length > 1) {
            px = height * 0.28;
            context.font = fontSpec(font, px);
            rows = wrapText(context, text.text, maxWidth, 2);
        }
        if (rows.length === 1) px = fitFont(context, font, rows[0]!, maxWidth, px);
        const center = height * 0.58;
        rows.forEach((row, index) => {
            const y = center + (index - (rows.length - 1) / 2) * px * 1.18;
            context.fillText(row, width / 2, y);
        });
        this.texture.needsUpdate = true;
    }

    update(frame: { time: number; delta: number; staticMode: boolean; level: number; color: THREE.Color }) {
        let glitch = 0;
        if (this.switchElapsed < SWITCH_SECONDS) {
            this.switchElapsed += frame.staticMode ? SWITCH_SECONDS : Math.max(frame.delta, 1 / 120);
            const t = Math.min(1, this.switchElapsed / SWITCH_SECONDS);
            if (t >= 0.4 && this.pending) {
                this.paint(this.pending.text, this.pending.font);
                this.pending = null;
            }
            glitch = t >= 1 ? 0 : Math.sin(Math.PI * t);
        }
        const time = frame.staticMode ? 0 : frame.time;
        const uniforms = this.panel.uniforms;
        uniforms.uTime!.value = time;
        uniforms.uLevel!.value = frame.level;
        uniforms.uGlitch!.value = glitch;
        (uniforms.uColor!.value as THREE.Color).copy(frame.color);
        this.beam.uniforms.uTime!.value = time;
        this.beam.uniforms.uLevel!.value = frame.level;
        (this.beam.uniforms.uColor!.value as THREE.Color).copy(frame.color);
    }

    get busy() {
        return this.switchElapsed < SWITCH_SECONDS;
    }

    dispose() {
        this.texture.dispose();
        this.geometries.forEach(geometry => geometry.dispose());
    }
}
