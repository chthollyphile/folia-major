import * as THREE from 'three';

// src/components/visualizer/machi/engine/sky.ts
// 天空：一张 4×256 的竖向渐变贴图，作为场景背景铺满画面。颜色插值时重画。

export class MachiSky {
    readonly texture: THREE.CanvasTexture;
    private readonly context: CanvasRenderingContext2D;

    constructor() {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 256;
        this.context = canvas.getContext('2d')!;
        this.texture = new THREE.CanvasTexture(canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
    }

    paint(top: THREE.Color, bottom: THREE.Color) {
        const gradient = this.context.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, `#${top.getHexString()}`);
        gradient.addColorStop(1, `#${bottom.getHexString()}`);
        this.context.fillStyle = gradient;
        this.context.fillRect(0, 0, 4, 256);
        this.texture.needsUpdate = true;
    }

    dispose() {
        this.texture.dispose();
    }
}
