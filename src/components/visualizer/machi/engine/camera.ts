import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MachiCameraView } from '../types';

// src/components/visualizer/machi/engine/camera.ts
// 町景的镜头：正交投影的斜俯视。缩放 1 时按视口把场景给的构图点（底座、最高的招牌……）都框进去，并给底部字幕让出一点；
// 默认构图再拉近到场景给的缩放，目标点往上挪，保住画面上沿的招牌，裁掉的是画面下沿离镜头最近的底座角。
// 可以拖拽旋转、滚轮 / 双指缩放、右键 / 双指沿地面平移（OrbitControls，限方位角默认视角 ±75°、俯角 20°–70°，
// 平移不出底座太远）。默认视角下松手约 8 秒后缓回默认构图；自定义视角（相对默认构图的转角、俯仰、缩放倍数、平移）
// 是镜头的静止位置：松手就停在那里，等镜头停稳后报给外面存起来。开着运镜时，镜头在静止位置附近缓慢地转、推拉、平移
// （几道周期互不成倍数的慢正弦，按氛围时间走，随歌曲暂停）；一拖就停，镜头回到静止位置后再慢慢接着走。

const DEG = Math.PI / 180;

/** 拖拽的范围与闲置回正（三个场景一样）。 */
export const MACHI_CAMERA_LIMITS = {
    azimuthRange: 75 * DEG,
    minElevation: 20 * DEG,
    maxElevation: 70 * DEG,
    minZoom: 0.75,
    maxZoom: 3.6,
    /** 目标点沿地面平移的上限（米，按默认朝向的左右、前后各算）。 */
    pan: 5,
    idleReturnSeconds: 8,
} as const;

/** 运镜从静止到全幅（或关掉后回到静止位置）用的秒数（真实时间）。 */
const DRIFT_RAMP_SECONDS = 4;

/** 运镜在 time 秒（氛围时间）时相对静止位置的偏移：转角、俯仰（度）、缩放倍数、左右与前后平移（米）。 */
export const resolveMachiDrift = (time: number): MachiCameraView => {
    const wave = (period: number, phase: number) => Math.sin((time / period) * Math.PI * 2 + phase);
    return {
        azimuth: 15 * wave(67, 0) + 5 * wave(29, 1.3),
        elevation: 4 * wave(47, 0.7),
        zoom: Math.exp(0.08 * wave(41, 2.1)),
        panX: 0.45 * wave(53, 0.4),
        panZ: 0.3 * wave(71, 2.6),
    };
};

export interface MachiView {
    azimuth: number;
    elevation: number;
    zoom: number;
}

/** 场景给的取景：要框进去的点与默认视角（方位角按 three 的球坐标，从 +z 转向 +x）。 */
export interface MachiCameraFraming {
    points: THREE.Vector3[];
    view: MachiView;
}

/** 构图留白（占画面的比例）与给字幕让出的下沿。 */
const MARGIN = 0.02;
const SUBTITLE_RESERVE = 0.05;
const CAMERA_DISTANCE = 60;
/** 默认缩放下装不下时，多出来的高度这么多从下沿裁（其余从上沿）。 */
const CROP_FROM_BOTTOM = 0.85;

const orbitDirection = (azimuth: number, elevation: number) => new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sameView = (a: MachiCameraView | null, b: MachiCameraView | null) => (
    a === b || (!!a && !!b && Math.abs(a.azimuth - b.azimuth) < 1e-4 && Math.abs(a.elevation - b.elevation) < 1e-4
        && Math.abs(a.zoom - b.zoom) < 1e-5 && Math.abs(a.panX - b.panX) < 1e-4 && Math.abs(a.panZ - b.panZ) < 1e-4)
);

export class MachiCamera {
    readonly camera: THREE.OrthographicCamera;
    private controls: OrbitControls | null = null;
    /** 默认构图的目标点，与镜头此刻绕着转的目标点（默认目标点 + 平移）。 */
    private readonly base = new THREE.Vector3();
    private readonly target = new THREE.Vector3();
    private framing: MachiCameraFraming = { points: [new THREE.Vector3()], view: { azimuth: 45 * DEG, elevation: 31 * DEG, zoom: 1 } };
    /** 构图点投影包围盒的中心（缩放 1 时的目标点）与镜头平面的“上”方向。 */
    private readonly fitCenter = new THREE.Vector3();
    private readonly fitUp = new THREE.Vector3();
    /** 默认构图：半高（缩放 1 时）。 */
    private halfHeight = 8;
    /** 构图点投影的半宽、半高（缩放 1 时）。 */
    private fitHalf = { width: 9, height: 7 };
    private aspect = 16 / 9;
    /** 自定义视角（相对默认构图）；null 是默认视角。 */
    private custom: MachiCameraView | null = null;
    private interacting = false;
    private idleSince = 0;
    private returning = false;
    /** 自定义视角下松了手：等阻尼停稳再报。 */
    private commitPending = false;
    private readonly spherical = new THREE.Spherical();
    /** 运镜：开没开、走到哪了（氛围时间）、此刻的幅度（0 静止位置，1 全幅）。 */
    private motion = false;
    private motionSpeed = 1;
    private motionTime = 0;
    private motionWeight = 0;
    /** 镜头有变化、需要补一帧（暂停时按需渲染用）。 */
    needsRender = true;
    /** 自定义视角下拖动停稳了：新视角（相对默认构图）交给外面存。 */
    onCommit: ((view: MachiCameraView) => void) | null = null;
    /** 镜头被拖动了：暂停时渲染循环睡着，要叫醒它。 */
    onWake: (() => void) | null = null;

    constructor() {
        this.camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 200);
        this.camera.name = 'Camera';
    }

    /** 默认视角（回正、调试钩子用）。 */
    get defaultView(): MachiView {
        return this.framing.view;
    }

    /** 换场景：新的构图点与默认视角、这个场景的自定义视角（null 是默认构图），镜头直接摆到静止位置。 */
    setFraming(framing: MachiCameraFraming, custom: MachiCameraView | null) {
        this.framing = framing;
        this.custom = custom;
        this.interacting = false;
        this.returning = false;
        this.commitPending = false;
        this.idleSince = 0;
        this.fitDefault();
        this.applyLimits();
        this.settle();
    }

    /** 开关运镜：开了从静止位置慢慢走起来，关了慢慢回到静止位置。speed 是快慢的倍数（只改往后走的快慢，不跳）。 */
    setMotion(motion: boolean, speed = 1) {
        this.motionSpeed = speed;
        if (motion === this.motion) return;
        this.motion = motion;
        this.needsRender = true;
    }

    /**
     * 换视角设置：自定义视角（相对默认构图）或 null（默认构图）。从默认切到自定义时，要是刚拖过、还没回正，
     * 就把此刻的视角当成自定义视角（拖到想要的地方再点“固定”）。
     */
    setCustom(view: MachiCameraView | null) {
        if (sameView(view, this.custom)) return;
        const adopt = view !== null && this.custom === null && this.controls !== null && (this.idleSince > 0 || this.returning);
        this.custom = view;
        this.returning = false;
        this.idleSince = 0;
        this.commitPending = false;
        if (adopt) {
            this.custom = this.offset();
            this.onCommit?.(this.custom);
            return;
        }
        if (this.interacting) return;
        if (view === null && this.controls) {
            // 回到默认构图：缓回去。
            this.returning = true;
            this.needsRender = true;
            return;
        }
        this.settle();
    }

    /** 按默认朝向把构图点投到镜头平面上，求目标点和半高。 */
    private fitDefault() {
        const { view } = this.framing;
        const direction = orbitDirection(view.azimuth, view.elevation);
        const forward = direction.clone().negate();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, forward).normalize();
        let minR = Infinity; let maxR = -Infinity; let minU = Infinity; let maxU = -Infinity;
        this.framing.points.forEach(point => {
            const r = point.dot(right);
            const u = point.dot(up);
            minR = Math.min(minR, r); maxR = Math.max(maxR, r);
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        });
        const centerR = (minR + maxR) / 2;
        const centerU = (minU + maxU) / 2;
        // 目标点放在投影包围盒中心（沿视线方向的位置无所谓，正交投影只看垂直于视线的平面）。
        this.fitUp.copy(up);
        this.fitCenter.copy(right.multiplyScalar(centerR)).add(up.clone().multiplyScalar(centerU));
        this.fitHalf = { width: (maxR - minR) / 2, height: (maxU - minU) / 2 };
        this.applyFrustum();
    }

    /**
     * 视口变了：按宽高比取能装下构图的半高，再给字幕让出下沿。默认缩放下竖向装不下的部分大多从下沿裁，
     * 所以目标点往上挪（只在竖向是瓶颈时；横向是瓶颈的竖屏视口竖向本来有富余）。平移量留着。
     */
    private applyFrustum() {
        const usable = 1 - MARGIN * 2 - SUBTITLE_RESERVE;
        const halfHeight = Math.max(this.fitHalf.height, this.fitHalf.width / this.aspect) / usable;
        this.halfHeight = halfHeight;
        const overflow = Math.max(0, this.fitHalf.height / usable - halfHeight / this.framing.view.zoom);
        const view = this.view();
        const pan = this.target.clone().sub(this.base);
        this.base.copy(this.fitCenter).addScaledVector(this.fitUp, overflow * (CROP_FROM_BOTTOM - 0.5) * 2);
        this.place(view, this.base.clone().add(pan));
        const shift = halfHeight * SUBTITLE_RESERVE;
        this.camera.left = -halfHeight * this.aspect;
        this.camera.right = halfHeight * this.aspect;
        this.camera.top = halfHeight - shift;
        this.camera.bottom = -halfHeight - shift;
        this.camera.updateProjectionMatrix();
        this.needsRender = true;
    }

    setAspect(width: number, height: number) {
        const aspect = width / Math.max(1, height);
        if (Math.abs(aspect - this.aspect) < 1e-4) return;
        this.aspect = aspect;
        this.applyFrustum();
    }

    /** 默认朝向的“右”与“往里”（都在地面上）：平移按它们算，换了视角平移的意思不变。 */
    private axes() {
        const azimuth = this.framing.view.azimuth;
        return {
            right: new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth)),
            back: new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth)),
        };
    }

    /** 静止时的视角：默认构图，或默认构图加上自定义的转角、俯仰、缩放倍数。 */
    private restView(): MachiView {
        const home = this.framing.view;
        const custom = this.custom;
        if (!custom) return home;
        return {
            azimuth: home.azimuth + custom.azimuth * DEG,
            elevation: clamp(home.elevation + custom.elevation * DEG, MACHI_CAMERA_LIMITS.minElevation, MACHI_CAMERA_LIMITS.maxElevation),
            zoom: clamp(home.zoom * custom.zoom, MACHI_CAMERA_LIMITS.minZoom, MACHI_CAMERA_LIMITS.maxZoom),
        };
    }

    /** 静止时的目标点：默认目标点加上自定义平移（再加上运镜的平移，一起夹在平移范围里）。 */
    private restTarget(extraX = 0, extraZ = 0) {
        const custom = this.custom;
        if (!custom && extraX === 0 && extraZ === 0) return this.base.clone();
        const { right, back } = this.axes();
        const limit = MACHI_CAMERA_LIMITS.pan;
        const x = clamp((custom?.panX ?? 0) + extraX, -limit, limit);
        const z = clamp((custom?.panZ ?? 0) + extraZ, -limit, limit);
        return this.base.clone().addScaledVector(right, x).addScaledVector(back, z);
    }

    /** 摆到静止位置，开着运镜就叠上此刻的运镜偏移（按幅度）。转角、俯仰、缩放都夹在拖拽的范围里。 */
    private settle() {
        const rest = this.restView();
        // 幅度按 smoothstep 缓起缓停。
        const weight = this.motionWeight * this.motionWeight * (3 - 2 * this.motionWeight);
        if (weight <= 0) {
            this.place(rest, this.restTarget());
            return;
        }
        const drift = resolveMachiDrift(this.motionTime);
        const home = this.framing.view.azimuth;
        const range = MACHI_CAMERA_LIMITS.azimuthRange;
        // 拉得越近，平移在画面上显得越大：按相对默认构图的缩放收一收。
        const panScale = weight * Math.min(1, this.framing.view.zoom / rest.zoom);
        this.place({
            azimuth: clamp(rest.azimuth + drift.azimuth * DEG * weight, home - range, home + range),
            elevation: clamp(rest.elevation + drift.elevation * DEG * weight, MACHI_CAMERA_LIMITS.minElevation, MACHI_CAMERA_LIMITS.maxElevation),
            zoom: clamp(rest.zoom * drift.zoom ** weight, MACHI_CAMERA_LIMITS.minZoom, MACHI_CAMERA_LIMITS.maxZoom),
        }, this.restTarget(drift.panX * panScale, drift.panZ * panScale));
    }

    /** 此刻的视角，相对默认构图（自定义视角存的就是它）。 */
    offset(): MachiCameraView {
        const home = this.framing.view;
        const view = this.view();
        const pan = this.target.clone().sub(this.base);
        const { right, back } = this.axes();
        return {
            azimuth: (view.azimuth - home.azimuth) / DEG,
            elevation: (view.elevation - home.elevation) / DEG,
            zoom: view.zoom / home.zoom,
            panX: pan.dot(right),
            panZ: pan.dot(back),
        };
    }

    /** 摆到某个视角、绕某个目标点。 */
    private place(view: MachiView, target: THREE.Vector3) {
        this.target.copy(target);
        this.controls?.target.copy(target);
        this.camera.position.copy(target).addScaledVector(orbitDirection(view.azimuth, view.elevation), CAMERA_DISTANCE);
        this.camera.zoom = view.zoom;
        this.camera.lookAt(target);
        this.camera.updateProjectionMatrix();
        this.controls?.update();
        this.needsRender = true;
    }

    /** 直接摆到某个视角，目标点不变（调试钩子用）。 */
    placeAt(view: MachiView) {
        this.place(view, this.target);
    }

    /** 回到静止位置（调试钩子用）。 */
    placeAtRest() {
        this.settle();
    }

    /** 当前视角。 */
    view(): MachiView {
        this.spherical.setFromVector3(this.camera.position.clone().sub(this.target));
        return { azimuth: this.spherical.theta, elevation: Math.PI / 2 - this.spherical.phi, zoom: this.camera.zoom };
    }

    /** 接上拖拽：限角、阻尼、缩放上下限；右键 / 双指沿地面平移。 */
    attach(element: HTMLElement) {
        if (this.controls) return;
        const controls = new OrbitControls(this.camera, element);
        controls.target.copy(this.target);
        controls.enablePan = true;
        controls.screenSpacePanning = false;
        controls.panSpeed = 0.8;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.rotateSpeed = 0.55;
        controls.zoomSpeed = 0.8;
        controls.minPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.maxElevation;
        controls.maxPolarAngle = Math.PI / 2 - MACHI_CAMERA_LIMITS.minElevation;
        controls.minZoom = MACHI_CAMERA_LIMITS.minZoom;
        controls.maxZoom = MACHI_CAMERA_LIMITS.maxZoom;
        controls.addEventListener('start', this.onStart);
        controls.addEventListener('end', this.onEnd);
        controls.addEventListener('change', this.onChange);
        this.controls = controls;
        this.applyLimits();
        controls.update();
    }

    /** 方位角限在默认视角两侧。 */
    private applyLimits() {
        if (!this.controls) return;
        this.controls.minAzimuthAngle = this.framing.view.azimuth - MACHI_CAMERA_LIMITS.azimuthRange;
        this.controls.maxAzimuthAngle = this.framing.view.azimuth + MACHI_CAMERA_LIMITS.azimuthRange;
    }

    private readonly onStart = () => {
        this.interacting = true;
        // 镜头交给拖拽：运镜停在这里，回到静止位置后从 0 幅度重新走起来。
        this.motionWeight = 0;
        this.returning = false;
        this.commitPending = false;
        this.onWake?.();
    };

    private readonly onEnd = () => {
        this.interacting = false;
        if (this.custom) this.commitPending = true;
        else this.idleSince = performance.now();
    };

    private readonly onChange = () => {
        this.target.copy(this.controls!.target);
        this.needsRender = true;
        this.onWake?.();
    };

    /** 平移不出范围：目标点按默认朝向的左右、前后各夹在 ±pan 米里，镜头跟着挪同样的量。 */
    private clampPan() {
        const controls = this.controls!;
        const pan = controls.target.clone().sub(this.base);
        const { right, back } = this.axes();
        const limit = MACHI_CAMERA_LIMITS.pan;
        const x = pan.dot(right);
        const z = pan.dot(back);
        if (Math.abs(x) <= limit && Math.abs(z) <= limit && Math.abs(pan.y) < 1e-6) return;
        const next = this.base.clone().addScaledVector(right, clamp(x, -limit, limit)).addScaledVector(back, clamp(z, -limit, limit));
        this.camera.position.add(next.clone().sub(controls.target));
        controls.target.copy(next);
        this.target.copy(next);
    }

    /** 镜头停在静止位置上（没在拖、没在回正、没在等报新视角、也没在等闲置回正）：运镜只在这时走。 */
    private get still() {
        return !this.interacting && !this.returning && !this.commitPending && this.idleSince === 0;
    }

    /** 运镜的幅度还在升降（开了正在走起来，或关了正在回去）。 */
    private get ramping() {
        return this.motion ? this.still && this.motionWeight < 1 : this.motionWeight > 0;
    }

    /** 镜头还在动（阻尼、回正、等着报新视角、运镜幅度在升降）：暂停时也要继续出帧。 */
    get busy() {
        return this.interacting || this.returning || this.commitPending || this.needsRender || this.ramping;
    }

    /**
     * 每帧推进：阻尼、闲置回正（只在默认视角下）、运镜、自定义视角下停稳后报新视角。realDelta 是真实时间（镜头属于界面，
     * 不随歌曲暂停，运镜幅度的升降也按它）；ambientDelta 是氛围时间，运镜按它走，歌曲暂停时停住。
     */
    update(realDelta: number, ambientDelta: number) {
        const controls = this.controls;
        // 预览不接拖拽，只有运镜。
        if (!controls) {
            this.stepMotion(realDelta, ambientDelta);
            return;
        }
        const home = this.framing.view;
        if (!this.custom && !this.interacting && !this.returning && this.idleSince > 0 && performance.now() - this.idleSince > MACHI_CAMERA_LIMITS.idleReturnSeconds * 1000) {
            const view = this.view();
            const off = Math.abs(view.azimuth - home.azimuth) + Math.abs(view.elevation - home.elevation) + Math.abs(view.zoom - home.zoom) + this.target.distanceTo(this.base);
            this.returning = off > 1e-3;
            this.idleSince = 0;
        }
        if (this.returning) {
            const view = this.view();
            const rest = this.restView();
            const k = 1 - Math.exp(-realDelta * 1.6);
            const next = {
                azimuth: view.azimuth + (rest.azimuth - view.azimuth) * k,
                elevation: view.elevation + (rest.elevation - view.elevation) * k,
                zoom: view.zoom + (rest.zoom - view.zoom) * k,
            };
            const restTarget = this.restTarget();
            const target = this.target.clone().lerp(restTarget, k);
            const done = Math.abs(next.azimuth - rest.azimuth) < 2e-4 && Math.abs(next.elevation - rest.elevation) < 2e-4
                && Math.abs(next.zoom - rest.zoom) < 2e-4 && target.distanceTo(restTarget) < 2e-3;
            this.place(done ? rest : next, done ? restTarget : target);
            if (done) this.returning = false;
        }
        this.stepMotion(realDelta, ambientDelta);
        this.clampPan();
        const moved = controls.update();
        if (moved) this.target.copy(controls.target);
        if (this.commitPending && !this.interacting && !moved) {
            this.commitPending = false;
            this.custom = this.offset();
            this.onCommit?.(this.custom);
        }
    }

    /** 运镜：镜头停在静止位置上时，幅度慢慢升到 1（关了就降回 0），按氛围时间走；别的时候幅度归零，交给拖拽和回正。 */
    private stepMotion(realDelta: number, ambientDelta: number) {
        if (!this.still) {
            this.motionWeight = 0;
            return;
        }
        if (this.motion) this.motionTime += ambientDelta * this.motionSpeed;
        const weight = this.motionWeight;
        const step = realDelta / DRIFT_RAMP_SECONDS;
        this.motionWeight = this.motion ? Math.min(1, weight + step) : Math.max(0, weight - step);
        // 幅度在 0 上不动就不用摆（默认视角的闲置、自定义视角都不受打扰）；从有到无那一帧还要摆回静止位置。
        if (weight > 0 || this.motionWeight > 0) {
            if (this.motionWeight !== weight || (this.motion && ambientDelta > 0)) this.settle();
        }
    }

    /** 渲染后清掉“要补帧”的标记。 */
    rendered() {
        this.needsRender = false;
    }

    /** 镜头到目标点的距离（画面中心的深度）。 */
    get focusDistance() {
        return this.camera.position.distanceTo(this.target);
    }

    /** 某一点沿视线的深度（对焦在场景里某个东西上时用）。 */
    depthOf(point: THREE.Vector3) {
        const forward = this.target.clone().sub(this.camera.position).normalize();
        return point.clone().sub(this.camera.position).dot(forward);
    }

    get frustumHalfHeight() {
        return this.halfHeight / this.camera.zoom;
    }

    dispose() {
        if (!this.controls) return;
        this.controls.removeEventListener('start', this.onStart);
        this.controls.removeEventListener('end', this.onEnd);
        this.controls.removeEventListener('change', this.onChange);
        this.controls.dispose();
        this.controls = null;
    }
}
