import * as THREE from 'three';
import type { SceneContext, ScreenPoint, ScreenQuad, Vec3 } from '../definition';

// src/components/scenes/kit/threeStage.ts
// 可选工具箱：给用 three.js 的场景一块画布（透明底、跟着盒子的大小、按画质档的分辨率倍数），
// 和把世界坐标（米）投到盒子像素上的 project——场景每帧用它把荧幕四个角交给 ctx.surfaces.place。
// 不用 three.js 的场景不碰这个文件；契约里没有 three.js 的类型。

export interface ThreeStageOptions {
    /** Transparent canvas, so the host's borrowed content can show through a hole. Default true. */
    alpha?: boolean;
    /** Multisampling on the window's buffer. Default true; a scene with its own lens passes turns it off. */
    antialias?: boolean;
    fov?: number;
    near?: number;
    far?: number;
}

export interface ThreeStage {
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    /** World points (metres) on the box in CSS pixels; null when one lies behind the camera. */
    project: (points: readonly Vec3[]) => ScreenPoint[] | null;
    /**
     * A surface's four corners for ctx.surfaces.place, homogeneous (ScreenPoint.w): whatever of it is in front
     * of the camera shows, the part behind is clipped by the browser.
     */
    projectQuad: (corners: readonly [Vec3, Vec3, Vec3, Vec3]) => ScreenQuad;
    render: (scene: THREE.Object3D) => void;
    dispose: () => void;
}

export const createThreeStage = (ctx: SceneContext, options: ThreeStageOptions = {}): ThreeStage => {
    const alpha = options.alpha ?? true;
    const renderer = new THREE.WebGLRenderer({ alpha, antialias: options.antialias ?? true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, alpha ? 0 : 1);
    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.container.appendChild(canvas);

    const camera = new THREE.PerspectiveCamera(options.fov ?? 45, 1, options.near ?? 0.05, options.far ?? 200);
    let width = 1;
    let height = 1;
    const resize = () => {
        width = Math.max(1, ctx.container.clientWidth);
        height = Math.max(1, ctx.container.clientHeight);
        // The quality preset's `dpr` is the resolution multiplier; without one, the screen's.
        const dpr = ctx.quality.get('dpr');
        renderer.setPixelRatio(typeof dpr === 'number' ? dpr : window.devicePixelRatio || 1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(ctx.container);
    // A new quality preset changes the resolution in place: the scene goes on as it was.
    const releaseQuality = ctx.quality.onChange(resize);

    const point = new THREE.Vector3();
    const clip = new THREE.Vector4();
    const project = (points: readonly Vec3[]) => {
        camera.updateMatrixWorld();
        const result: ScreenPoint[] = [];
        for (const [x, y, z] of points) {
            point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
            if (point.z > -camera.near) return null;
            point.applyMatrix4(camera.projectionMatrix);
            result.push({ x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height });
        }
        return result;
    };

    return {
        renderer,
        camera,
        project,
        projectQuad: (corners) => {
            camera.updateMatrixWorld();
            const quad = corners.map(([x, y, z]) => {
                clip.set(x, y, z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
                return { x: ((clip.x + clip.w) / 2) * width, y: ((clip.w - clip.y) / 2) * height, w: clip.w };
            });
            // All behind the camera it is still placed (the browser clips it all): hiding it would save nothing, as
            // the lyric style keeps drawing either way, and showing it again would make the browser redraw its layer.
            return quad as unknown as ScreenQuad;
        },
        render: scene => renderer.render(scene, camera),
        dispose: () => {
            observer.disconnect();
            releaseQuality();
            renderer.dispose();
            // The context goes now, not at garbage collection: Chromium drops the oldest past about 16,
            // which can be another WebGL view of the app. The host has stopped listening for the loss by now.
            renderer.forceContextLoss();
            canvas.remove();
        },
    };
};
