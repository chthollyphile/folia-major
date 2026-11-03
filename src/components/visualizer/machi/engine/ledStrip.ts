import * as THREE from 'three';
import type { MachiColorBlend, MachiMaterials } from './materials';
import { createCanvas, paintMachiLedStrip, type MachiFont } from './signRaster';

// src/components/visualizer/machi/engine/ledStrip.ts
// LED 点阵跑马灯（便利店店招上的一条、出租车顶灯）：字条先画进一长条黑底白字的 canvas，着色器按点阵采样、
// 着 LED 色、横向滚动。字条只在内容变了时重画，每帧只推滚动位置。

const TEXTURE = { width: 4096, height: 96 };

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLed;
uniform float uScroll;
uniform float uUsed;
uniform float uWindow;
uniform float uDots;
uniform float uAspect;
uniform float uBright;
varying vec2 vUv;
void main() {
    vec2 grid = vec2(floor(uDots * uAspect), uDots);
    vec2 cell = floor(vUv * grid);
    vec2 f = fract(vUv * grid) - 0.5;
    vec2 sampleUv = (cell + 0.5) / grid;
    float u = fract(uScroll + sampleUv.x * uWindow) * uUsed;
    float a = texture2D(uMap, vec2(u, sampleUv.y)).r;
    float dotMask = 1.0 - smoothstep(0.28, 0.42, length(f));
    vec3 off = vec3(0.025, 0.022, 0.03);
    vec3 color = mix(off, mix(uLed * 0.08, uLed * 2.2, a) * uBright, dotMask);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export interface MachiLedStripFrame {
    delta: number;
    staticMode: boolean;
    /** 滚动速度的倍数（副歌时快一点）。 */
    speed: number;
    audio: number;
}

export class MachiLedStrip {
    readonly material: THREE.ShaderMaterial;
    private readonly canvas = createCanvas(TEXTURE.width, TEXTURE.height);
    private readonly texture: THREE.CanvasTexture;
    private readonly geometries: THREE.BufferGeometry[] = [];
    private text = '';
    private scroll = 0;

    /** width / height 是灯条的尺寸（米），dots 是竖向的点数。colorKey 是 LED 的颜色键。 */
    constructor(
        materials: MachiMaterials,
        private readonly blend: MachiColorBlend,
        private readonly width: number,
        private readonly height: number,
        dots = 18,
        private readonly colorKey = 'led',
    ) {
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.NoColorSpace;
        this.texture.wrapS = THREE.ClampToEdgeWrapping;
        this.material = materials.track(new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uMap: { value: this.texture },
                uLed: { value: new THREE.Color() },
                uScroll: { value: 0 },
                uUsed: { value: 1 },
                uWindow: { value: 0.3 },
                uDots: { value: dots },
                uAspect: { value: width / height },
                uBright: { value: 1 },
            },
        }));
        this.material.name = 'machi:led';
    }

    /** 一块灯条面（平面网格）。 */
    createFace(position: THREE.Vector3, rotationY: number, name: string) {
        const geometry = new THREE.PlaneGeometry(this.width, this.height);
        this.geometries.push(geometry);
        const face = new THREE.Mesh(geometry, this.material);
        face.name = name;
        face.position.copy(position);
        face.rotation.y = rotationY;
        return face;
    }

    /** 换字：内容一样就不重画。 */
    setText(text: string, font: MachiFont) {
        if (text === this.text) return;
        this.text = text;
        const used = paintMachiLedStrip(this.canvas, font, text);
        this.texture.needsUpdate = true;
        const uniforms = this.material.uniforms;
        uniforms.uUsed!.value = used / TEXTURE.width;
        const dots = uniforms.uDots!.value as number;
        const aspect = uniforms.uAspect!.value as number;
        // 一个点对应字条的 height / dots 像素：可见窗口宽度占循环长度的比例。
        uniforms.uWindow!.value = Math.min(4, (Math.floor(dots * aspect) * (TEXTURE.height / dots)) / Math.max(1, used));
    }

    /** 内容作废（换主题、换字体）：下次 setText 一定重画。 */
    invalidate() {
        this.text = '';
    }

    get hasText() {
        return this.text !== '';
    }

    update(frame: MachiLedStripFrame) {
        const speed = (frame.staticMode ? 0 : 70) * frame.speed;
        const used = (this.material.uniforms.uUsed!.value as number) * TEXTURE.width;
        this.scroll = (this.scroll + (frame.delta * speed) / Math.max(1, used)) % 1;
        this.material.uniforms.uScroll!.value = this.scroll;
        (this.material.uniforms.uLed!.value as THREE.Color).copy(this.blend.get(this.colorKey));
        this.material.uniforms.uBright!.value = 0.9 + 0.2 * frame.audio;
    }

    dispose() {
        this.texture.dispose();
        this.geometries.forEach(geometry => geometry.dispose());
    }
}
