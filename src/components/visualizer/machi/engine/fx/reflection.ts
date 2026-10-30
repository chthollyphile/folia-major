import * as THREE from 'three';

// src/components/visualizer/machi/engine/fx/reflection.ts
// 水洼里的倒影：把正交镜头按地面（y = planeY）镜像，只渲染 REFLECT 图层上的亮东西（招牌、灯箱、天花灯、
// 灯头、贩卖机、只在倒影里出现的“橱窗光”）到半分辨率的 HDR 贴图；湿路面的着色器按 textureMatrix 投影取样。
// 暗的墙和地本来就映不出什么，不画它们，倒影一帧只多十几个 draw call。

/** 只在倒影里出现、或者主画面和倒影都要出现的图层。 */
export const MACHI_REFLECT_LAYER = 1;

export class MachiReflection {
    readonly target: THREE.WebGLRenderTarget;
    readonly textureMatrix = new THREE.Matrix4();
    private readonly mirror = new THREE.OrthographicCamera();
    private readonly up = new THREE.Vector3();
    private readonly lookTarget = new THREE.Vector3();
    private readonly forward = new THREE.Vector3();
    private scale: number;

    /** 镜像平面的高度（换场景时由场景给）。 */
    planeY: number;

    constructor(planeY: number, scale: number) {
        this.planeY = planeY;
        this.scale = scale;
        // 带 mipmap：湿路面按粗糙度取糊一点的那一级，倒影不至于像镜子。
        this.target = new THREE.WebGLRenderTarget(1, 1, {
            type: THREE.HalfFloatType,
            depthBuffer: true,
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter,
        });
        this.target.texture.name = 'machi:reflection';
        this.mirror.layers.set(MACHI_REFLECT_LAYER);
    }

    setSize(width: number, height: number) {
        this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
    }

    setScale(scale: number, width: number, height: number) {
        this.scale = scale;
        this.setSize(width, height);
    }

    /** 跟着主镜头更新镜像镜头和投影矩阵，再把 REFLECT 图层画进贴图。 */
    render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera) {
        const y = this.planeY;
        this.mirror.left = camera.left;
        this.mirror.right = camera.right;
        this.mirror.top = camera.top;
        this.mirror.bottom = camera.bottom;
        this.mirror.near = camera.near;
        this.mirror.far = camera.far;
        this.mirror.zoom = camera.zoom;
        this.mirror.updateProjectionMatrix();
        this.mirror.position.set(camera.position.x, 2 * y - camera.position.y, camera.position.z);
        camera.getWorldDirection(this.forward);
        this.lookTarget.copy(camera.position).add(this.forward);
        this.lookTarget.y = 2 * y - this.lookTarget.y;
        this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
        this.up.y = -this.up.y;
        this.mirror.up.copy(this.up);
        this.mirror.lookAt(this.lookTarget);
        this.mirror.updateMatrixWorld();
        this.textureMatrix.set(
            0.5, 0, 0, 0.5,
            0, 0.5, 0, 0.5,
            0, 0, 0.5, 0.5,
            0, 0, 0, 1,
        ).multiply(this.mirror.projectionMatrix).multiply(this.mirror.matrixWorldInverse);

        const background = scene.background;
        const fog = scene.fog;
        const previousTarget = renderer.getRenderTarget();
        const previousClear = renderer.getClearColor(new THREE.Color());
        const previousAlpha = renderer.getClearAlpha();
        const shadowAuto = renderer.shadowMap.autoUpdate;
        scene.background = null;
        scene.fog = null;
        renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(this.target);
        renderer.setClearColor(0x000000, 1);
        renderer.clear();
        renderer.render(scene, this.mirror);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousClear, previousAlpha);
        renderer.shadowMap.autoUpdate = shadowAuto;
        scene.background = background;
        scene.fog = fog;
    }

    dispose() {
        this.target.dispose();
    }
}
