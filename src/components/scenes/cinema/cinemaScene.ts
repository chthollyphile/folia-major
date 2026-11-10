import * as THREE from 'three';
import { PROJECTOR, SCREEN } from './cinemaLayout';
import {
    buildAudienceGeometry,
    buildAudienceMatrices,
    buildGlowPoints,
    buildRoomGeometry,
    buildSeatGeometry,
    buildSeatMatrices,
    buildSideCurtains,
    curtainGap,
} from './cinemaGeometry';
import { createIntermission, type CurtainPose } from './cinemaIntermission';
import { CINEMA_SHADERS } from './cinemaShaders';
import { createLeaderReel, type CinemaReel } from './cinemaReel';
import { createCinemaPost } from './cinemaPost';

// src/components/scenes/cinema/cinemaScene.ts
// The cinema as plain three.js objects: the room and its seats (one shader), the side curtains, the
// people in the seats, the screen, the projector beam, the dust in it and the small lamps, filmed by the
// camera the runtime moved (cinemaRuntime.ts) through the lens passes (cinemaPost.ts). update() moves it
// one frame from numbers only; dispose() frees every GPU resource it made. The screen's picture area is
// left see-through: the user's lyric style and background lie under the canvas there (the host's surface).
// The reel (the cover) is never shown; it colours the light the projector throws into the hall until the
// screen's own picture is sampled (setScreenLight), and again without one.

/** How long a change of reels takes. */
const REEL_SECONDS = 1.7;
const DUST_COUNT = 520;
const SCREEN_MARGIN = 0.32;

export interface CinemaFrameInput {
    /** Seconds since the last frame, paused or not: a pause stops the film, not the hall's air and grain. */
    dt: number;
    running: boolean;
    /** Audio, each 0..1. */
    power: number;
    bass: number;
    /** The house lights up by hand (the scene's setting); the hall's own lights, never the screen's theme. */
    lightsUp: boolean;
    /** The app's static mode: no intermission, everything at once where it belongs. */
    still?: boolean;
    /** The user's setting: a pause closes the curtains (an intermission); false, a pause changes nothing. */
    curtainsOnPause?: boolean;
    /** The cove strips' colour, linear. */
    cove: THREE.Color;
    camera: THREE.PerspectiveCamera;
    bufferSize: THREE.Vector2;
}

export interface CinemaScene {
    /** Shows a new reel; with animate, through a change-over, otherwise at once. Null shows the leader. */
    setReel: (reel: CinemaReel | null, animate: boolean) => void;
    /** The light of what the screen shows now (thirdColors of a sample); null goes back to the reel's light. */
    setScreenLight: (colors: CinemaReel['colors'] | null) => void;
    /** Moves the hall one frame; returns the projector's shutter, 1 open to 0 shut. */
    update: (input: CinemaFrameInput) => number;
    /** Draws the frame through the lens passes. */
    render: (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => void;
    /** Compiles the shaders ahead of the first frame (see CinemaPost.compile). */
    compile: (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => Promise<void>;
    dispose: () => void;
}

/** Tileable 3D value noise for the smoke in the beam, softened once so filtering shows no grid. */
const createSmokeNoise = () => {
    const size = 32;
    const raw = new Float32Array(size * size * size);
    for (let index = 0; index < raw.length; index += 1) raw[index] = Math.random();
    const at = (x: number, y: number, z: number) => raw[((z + size) % size) * size * size + ((y + size) % size) * size + ((x + size) % size)];
    const data = new Uint8Array(raw.length);
    for (let z = 0; z < size; z += 1) {
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                let sum = 0;
                let weight = 0;
                for (let dz = -1; dz <= 1; dz += 1) {
                    for (let dy = -1; dy <= 1; dy += 1) {
                        for (let dx = -1; dx <= 1; dx += 1) {
                            const w = (2 - Math.abs(dx)) * (2 - Math.abs(dy)) * (2 - Math.abs(dz));
                            sum += at(x + dx, y + dy, z + dz) * w;
                            weight += w;
                        }
                    }
                }
                // Stretch the softened values back to the full range.
                data[z * size * size + y * size + x] = Math.round(Math.min(1, Math.max(0, (sum / weight - 0.5) * 2.6 + 0.5)) * 255);
            }
        }
    }
    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
};

/** The four planes of the beam's pyramid (lens to the screen's edges), as (inward normal, offset). */
const beamPlanes = () => {
    const lens = new THREE.Vector3(0, PROJECTOR.y, PROJECTOR.z);
    const bottom = SCREEN.centerY - SCREEN.height / 2;
    const top = SCREEN.centerY + SCREEN.height / 2;
    const half = SCREEN.width / 2;
    const corners = [
        new THREE.Vector3(-half, bottom, 0),
        new THREE.Vector3(half, bottom, 0),
        new THREE.Vector3(half, top, 0),
        new THREE.Vector3(-half, top, 0),
    ];
    const centre = new THREE.Vector3(0, SCREEN.centerY, 0).sub(lens);
    return corners.map((corner, index) => {
        const next = corners[(index + 1) % 4];
        const normal = new THREE.Vector3().crossVectors(corner.clone().sub(lens), next.clone().sub(lens)).normalize();
        if (normal.dot(centre) < 0) normal.negate();
        return new THREE.Vector4(normal.x, normal.y, normal.z, -normal.dot(lens));
    });
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** The share of each screen third the cover itself fills; the rest is the dimmed backdrop. */
const THIRD_WEIGHTS = [0.32, 1, 0.32];

/** Lets a frame through between the heavier builds (each 5 to 30 ms), so building the hall never holds the page for one long stretch. */
const breathe = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

export const createCinemaScene = async (): Promise<CinemaScene> => {
    const leader = createLeaderReel();
    const noise = createSmokeNoise();
    const uniforms = {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uExposure: { value: 1 },
        uFocus: { value: 14 },
        uAperture: { value: 0.1 },
        uScreenL: { value: new THREE.Vector3() },
        uScreenC: { value: new THREE.Vector3() },
        uScreenR: { value: new THREE.Vector3() },
        uAmbient: { value: new THREE.Vector3() },
        uHaze: { value: new THREE.Vector3() },
        uCove: { value: new THREE.Vector3() },
        uHouse: { value: 0 },
        uSconce: { value: 0.55 },
        uFoot: { value: 0.9 },
        uDay: { value: 0 },
        uBoxLamp: { value: 1 },
        uTexA: { value: leader.texture },
        uTexB: { value: leader.texture },
        uAspectA: { value: 1 },
        uAspectB: { value: 1 },
        uChange: { value: 1 },
        uShutter: { value: 1 },
        uMargin: { value: new THREE.Vector2(SCREEN_MARGIN / SCREEN.width, SCREEN_MARGIN / SCREEN.height) },
        uInvViewProj: { value: new THREE.Matrix4() },
        uBeamPlanes: { value: beamPlanes() },
        uNoise: { value: noise },
        uBeamGain: { value: 0.05 },
        uSmokeTime: { value: 0 },
        uDustTime: { value: 0 },
        uProjScale: { value: 1000 },
        uDustGain: { value: 0.04 },
        uGlowGain: { value: 1 },
    };

    const scene = new THREE.Scene();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const keep = <T extends THREE.BufferGeometry | THREE.Material>(item: T): T => {
        if (item instanceof THREE.Material) materials.push(item);
        else geometries.push(item);
        return item;
    };

    const roomMaterial = keep(new THREE.ShaderMaterial({ ...CINEMA_SHADERS.room, uniforms }));
    const instanced = (geometry: THREE.BufferGeometry, matrices: THREE.Matrix4[]) => {
        const mesh = new THREE.InstancedMesh(keep(geometry), roomMaterial, matrices.length);
        matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        return mesh;
    };
    await breathe();
    const seats = instanced(buildSeatGeometry(), buildSeatMatrices());
    seats.renderOrder = 0;
    const audience = instanced(buildAudienceGeometry(), buildAudienceMatrices());
    audience.renderOrder = 0;
    await breathe();
    const room = new THREE.Mesh(keep(buildRoomGeometry()), roomMaterial);
    room.renderOrder = 1;
    await breathe();
    // The side curtains move in an intermission (cinemaIntermission.ts): their own mesh, hung anew only while they move.
    const curtains = buildSideCurtains();
    const curtainMesh = new THREE.Mesh(keep(curtains.geometry), roomMaterial);
    curtainMesh.renderOrder = 1;
    await breathe();
    const intermission = createIntermission();
    const hung = { left: { top: 0, bottom: 0 }, right: { top: 0, bottom: 0 } };
    const moved = (pose: CurtainPose, last: CurtainPose) => Math.abs(pose.top - last.top) > 1e-4 || Math.abs(pose.bottom - last.bottom) > 1e-4;

    const screen = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(SCREEN.width + SCREEN_MARGIN * 2, SCREEN.height + SCREEN_MARGIN * 2)),
        keep(new THREE.ShaderMaterial({ ...CINEMA_SHADERS.screen, uniforms })),
    );
    screen.position.set(0, SCREEN.centerY, 0.02);
    screen.renderOrder = 2;

    // Light added onto what is drawn; alpha (how out of focus the pixel is) is left as the surface wrote it.
    const additive = (shader: { vertexShader: string; fragmentShader: string; }, depthTest: boolean) => keep(new THREE.ShaderMaterial({
        ...shader,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
    }));

    const glowPoints = buildGlowPoints();
    const glowGeometry = keep(new THREE.BufferGeometry());
    glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(glowPoints.flatMap(point => point.position), 3));
    glowGeometry.setAttribute('aColor', new THREE.Float32BufferAttribute(glowPoints.flatMap(point => point.color), 3));
    glowGeometry.setAttribute('aSizeKind', new THREE.Float32BufferAttribute(glowPoints.flatMap(point => [point.size, point.kind]), 2));
    const glows = new THREE.Points(glowGeometry, additive(CINEMA_SHADERS.glow, true));
    glows.renderOrder = 5;

    const dustGeometry = keep(new THREE.BufferGeometry());
    const seeds = new Float32Array(DUST_COUNT * 4);
    for (let index = 0; index < seeds.length; index += 1) seeds[index] = Math.random();
    dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
    dustGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
    const dust = new THREE.Points(dustGeometry, additive(CINEMA_SHADERS.dust, true));
    dust.renderOrder = 6;

    // The beam is drawn by the lens passes after the hall, from its depth (cinemaPost.ts): it stops at the curtains and the walls.
    const beam = keep(new THREE.ShaderMaterial({ ...CINEMA_SHADERS.beam, uniforms: { ...uniforms }, depthTest: false, depthWrite: false }));
    const post = createCinemaPost(beam);

    [seats, audience, room, curtainMesh, screen, glows, dust].forEach(object => {
        object.frustumCulled = false;
        scene.add(object);
    });

    let reelA: CinemaReel = leader;
    let reelB: CinemaReel = leader;
    let change = 1;
    let time = 0;
    let day = 0;
    let power = 0;
    let bass = 0;
    let smokeTime = 0;
    let dustTime = 0;
    const lightA = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const lightB = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const reelLights = (reel: CinemaReel, out: THREE.Vector3[]) => {
        reel.colors.forEach((color, index) => out[index].set(color.r, color.g, color.b).multiplyScalar(THIRD_WEIGHTS[index]));
    };
    reelLights(leader, lightA);
    reelLights(leader, lightB);

    const releaseReel = (reel: CinemaReel) => {
        if (reel !== leader && reel !== reelA && reel !== reelB) reel.texture.dispose();
    };

    const setReel = (reel: CinemaReel | null, animate: boolean) => {
        const next = reel ?? leader;
        if (next === reelA) return;
        const dropped = reelB;
        reelB = reelA;
        reelA = next;
        releaseReel(dropped);
        change = animate ? 0 : 1;
        uniforms.uTexA.value = reelA.texture;
        uniforms.uTexB.value = reelB.texture;
        uniforms.uAspectA.value = reelA.aspect;
        uniforms.uAspectB.value = reelB.aspect;
        reelLights(reelA, lightA);
        reelLights(reelB, lightB);
    };

    // The screen's own picture, sampled a few times a second: the hall's light eases to it, and back to the reel without one.
    const liveTarget = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const live = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let liveOn = false;
    let liveWeight = 0;
    const setScreenLight = (colors: CinemaReel['colors'] | null) => {
        if (colors) {
            colors.forEach((color, index) => liveTarget[index].set(color.r, color.g, color.b));
            // The first sample is taken as it is; later ones are eased to.
            if (liveWeight === 0) live.forEach((light, index) => light.copy(liveTarget[index]));
        }
        liveOn = colors !== null;
    };

    const average = new THREE.Vector3();
    /** The screen's light as projected, curtains or not: the beam's strength is held against it. */
    const projected = new THREE.Vector3();
    const mixed = new THREE.Vector3();

    const update = ({ dt, running, power: powerIn, bass: bassIn, lightsUp, still, curtainsOnPause, cove, camera, bufferSize }: CinemaFrameInput) => {
        time += dt;
        power = running ? ease(power, powerIn, 5, dt) : power;
        bass = running ? ease(bass, bassIn, 7, dt) : bass;
        // The house lights, the shutter and the curtains: a pause turns into an intermission.
        const show = intermission.step(dt, running, lightsUp, still, curtainsOnPause);
        day = show.lights;
        const shutter = show.shutter;
        if (moved(show.left, hung.left) || moved(show.right, hung.right)) {
            curtains.set(show.left, show.right);
            Object.assign(hung.left, show.left);
            Object.assign(hung.right, show.right);
        }
        change = running ? Math.min(1, change + dt / REEL_SECONDS) : 1;
        smokeTime += dt * (1 + 1.4 * power);
        dustTime += dt * (1 + 1.8 * power);

        // Focused on the screen's centre from wherever the camera is.
        uniforms.uFocus.value = Math.hypot(camera.position.x, camera.position.y - SCREEN.centerY, camera.position.z);
        uniforms.uInvViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
        uniforms.uProjScale.value = bufferSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        uniforms.uResolution.value.copy(bufferSize);

        const cross = smoothstep(0.42, 0.58, change);
        const breathe = 1 + 0.08 * bass;
        const screenPower = lerp(6.5, 1.1, day) * breathe;
        const lights = [uniforms.uScreenL.value, uniforms.uScreenC.value, uniforms.uScreenR.value];
        // Drawn curtains catch the projector's light: the screen behind them is in their shadow and gives no light. Share of each third left uncovered:
        const gap = curtainGap(show.left, show.right);
        const third = SCREEN.width / 6;
        const side = Math.min(1, Math.max(0, (gap - third) / (2 * third)));
        const uncovered = [side, Math.min(1, gap / third), side];
        average.set(0, 0, 0);
        projected.set(0, 0, 0);
        liveWeight = ease(liveWeight, liveOn ? 1 : 0, 2, dt);
        if (liveWeight < 1e-3 && !liveOn) liveWeight = 0;
        lights.forEach((light, index) => {
            live[index].lerp(liveTarget[index], 1 - Math.exp(-3 * dt));
            mixed.lerpVectors(lightB[index], lightA[index], cross).lerp(live[index], liveWeight).multiplyScalar((1 - day) * shutter);
            // By day the house lights wash the screen out: it gives back a pale, even light.
            mixed.addScalar(day * 0.32);
            light.copy(mixed).multiplyScalar(screenPower);
            projected.add(light);
            light.multiplyScalar(uncovered[index]);
            average.add(light);
        });
        average.multiplyScalar(1 / 3);

        uniforms.uTime.value = time;
        uniforms.uDay.value = day;
        uniforms.uShutter.value = shutter;
        uniforms.uChange.value = change;
        uniforms.uAmbient.value.copy(average).multiplyScalar(0.012).add(new THREE.Vector3(0.0018, 0.002, 0.0027).multiplyScalar(1 - day));
        // By day a little warm air only: more haze greys the far hall over and washes the colours out.
        uniforms.uHaze.value.copy(average).multiplyScalar(0.004 * (1 - day)).add(new THREE.Vector3(0.2, 0.15, 0.1).multiplyScalar(day * 0.1));
        // At night a dim show level stays on, so the rows never vanish whatever colour the screen throws.
        uniforms.uHouse.value = lerp(0.085, 1.7, day);
        uniforms.uSconce.value = lerp(1.05, 0.9, day);
        uniforms.uFoot.value = lerp(0.7, 0.55, day);
        uniforms.uBoxLamp.value = lerp(0.78, 0.6, day);
        uniforms.uCove.value.set(cove.r, cove.g, cove.b).multiplyScalar(lerp(0.32, 0.5, day));
        // Bright covers would fill the hall with fog: the beam is held to about the same strength for every cover.
        const screenLuminance = (0.2126 * projected.x + 0.7152 * projected.y + 0.0722 * projected.z) / (3 * Math.max(screenPower, 1e-3));
        uniforms.uBeamGain.value = lerp(0.06, 0.006, day) * (1 + 0.18 * bass) * Math.min(1.6, 0.16 / Math.max(screenLuminance, 0.02)) * shutter;
        uniforms.uSmokeTime.value = smokeTime;
        uniforms.uDustTime.value = dustTime;
        // Dust shows only in the beam.
        uniforms.uDustGain.value = lerp(0.35, 0.03, day) * (1 + 0.6 * power) * shutter;
        return shutter;
    };

    const postFrame = { time: 0, grain: 0, vignette: 0, bloom: 0, focus: 14, aperture: 0.1 };
    const render = (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => {
        const night = 1 - Math.max(0, day);
        postFrame.time = time;
        postFrame.grain = lerp(0.022, 0.05, night);
        postFrame.vignette = lerp(0.22, 0.5, night);
        postFrame.bloom = lerp(0.15, 0.5, night);
        postFrame.focus = uniforms.uFocus.value;
        postFrame.aperture = uniforms.uAperture.value;
        post.render(renderer, scene, camera, postFrame);
    };

    const dispose = () => {
        post.dispose();
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
        seats.dispose();
        audience.dispose();
        noise.dispose();
        [reelA, reelB].forEach(reel => {
            if (reel !== leader) reel.texture.dispose();
        });
        leader.texture.dispose();
    };

    const compile = (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => post.compile(renderer, scene, camera);

    return { setReel, setScreenLight, update, render, compile, dispose };
};
