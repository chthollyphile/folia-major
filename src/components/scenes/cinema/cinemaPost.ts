import * as THREE from 'three';

// src/components/scenes/cinema/cinemaPost.ts
// The camera's lens after the hall is drawn: the hall goes into a 4x multisampled target (clean edges
// on every rail, seat row and curtain), then two blurred copies of it (half and quarter size) give the
// depth of field, a bright pass blurred at quarter size gives the bloom of the lamps,
// and the last pass mixes them, adds the vignette and the film grain, and draws to the canvas.
// How far out of focus each pixel is comes from the depth of the hall's pass and the camera's focus.
// Alpha is coverage and goes through to the canvas: 1 for the hall, near 0 over the screen's picture
// area (cinemaScene.ts), so the user's picture under the canvas shows there as it is: nothing of the
// hall (bloom, the beam, dust, the vignette, the grain) is drawn over it.
// Plain 8-bit targets: the shaders tone map themselves, and a half-float multisampled target drew
// black in Chrome on ANGLE d3d11.

export interface CinemaPostFrame {
    time: number;
    /** Film grain and vignette strength. */
    grain: number;
    vignette: number;
    /** How strongly lamps and the screen bloom. */
    bloom: number;
    /** Distance in metres that is sharp, and how fast the blur grows away from it. */
    focus: number;
    aperture: number;
}

export interface CinemaPost {
    render: (renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, frame: CinemaPostFrame) => void;
    /**
     * Compiles every program render() will use (the scene's and the passes'), for the targets they draw into,
     * off the main thread where the browser can (KHR_parallel_shader_compile); resolves once they are ready.
     */
    compile: (renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera) => Promise<void>;
    dispose: () => void;
}

const QUAD_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// How far out of focus the surface at uv is (0 sharp .. 1 fully soft), from the hall's depth.
const COC_GLSL = `
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform float uFocus;
uniform float uAperture;
float cocAt(vec2 uv) {
    vec4 view = uInvProj * vec4(uv * 2.0 - 1.0, texture2D(uDepth, uv).r * 2.0 - 1.0, 1.0);
    float dist = length(view.xyz / view.w);
    return clamp(uAperture * (uFocus / max(dist, 0.05) - 1.0), 0.0, 1.0);
}
`;

// A 2x box down-sample from four bilinear taps; with uBright, only what is brighter than the knee stays.
// With uFromDepth (the first step down from the hall) alpha becomes the blur amount, from the depth.
const DOWN_FRAGMENT = `
${COC_GLSL}
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uBright;
uniform float uFromDepth;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(uSource, vUv + uTexel * vec2(-0.5, -0.5))
        + texture2D(uSource, vUv + uTexel * vec2(0.5, -0.5))
        + texture2D(uSource, vUv + uTexel * vec2(-0.5, 0.5))
        + texture2D(uSource, vUv + uTexel * vec2(0.5, 0.5));
    c *= 0.25;
    if (uFromDepth > 0.5) {
        c.a = 0.25 * (cocAt(vUv + uTexel * vec2(-0.5, -0.5)) + cocAt(vUv + uTexel * vec2(0.5, -0.5))
            + cocAt(vUv + uTexel * vec2(-0.5, 0.5)) + cocAt(vUv + uTexel * vec2(0.5, 0.5)));
    }
    if (uBright > 0.5) {
        float l = max(c.r, max(c.g, c.b));
        float k = smoothstep(0.55, 1.0, l);
        c = vec4(c.rgb * k * k, 1.0);
    }
    gl_FragColor = c;
}
`;

// A 9-tap Gaussian along one direction; alpha (the blur amount) is blurred too, so a near object's
// blur reaches over the sharp things around it.
const BLUR_FRAGMENT = `
uniform sampler2D uSource;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(uSource, vUv) * 0.2042;
    c += (texture2D(uSource, vUv + uStep) + texture2D(uSource, vUv - uStep)) * 0.1802;
    c += (texture2D(uSource, vUv + uStep * 2.0) + texture2D(uSource, vUv - uStep * 2.0)) * 0.1238;
    c += (texture2D(uSource, vUv + uStep * 3.0) + texture2D(uSource, vUv - uStep * 3.0)) * 0.0663;
    c += (texture2D(uSource, vUv + uStep * 4.0) + texture2D(uSource, vUv - uStep * 4.0)) * 0.0276;
    gl_FragColor = c;
}
`;

const COMPOSITE_FRAGMENT = `
${COC_GLSL}
uniform sampler2D uSharp;
uniform sampler2D uSoft;
uniform sampler2D uSofter;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uBloomGain;
uniform sampler2D uVolume;
varying vec2 vUv;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec4 sharp = texture2D(uSharp, vUv);
    vec4 soft = texture2D(uSoft, vUv);
    vec4 softer = texture2D(uSofter, vUv);
    // Out of focus: the pixel's own blur, or the blur of a near thing spreading over it.
    float cover = sharp.a;
    float coc = max(cocAt(vUv), max(soft.a, softer.a * 0.9));
    vec3 c = mix(sharp.rgb, soft.rgb, smoothstep(0.02, 0.3, coc));
    c = mix(c, softer.rgb, smoothstep(0.3, 0.85, coc));
    // Bloom: added light, so it never darkens; a gentle shoulder keeps the brightest parts from clipping flat.
    vec2 bt = 0.5 / uResolution * 4.0;
    vec3 bloom = (texture2D(uBloom, vUv + vec2(bt.x, bt.y)) + texture2D(uBloom, vUv - vec2(bt.x, bt.y))
        + texture2D(uBloom, vUv + vec2(bt.x, -bt.y)) + texture2D(uBloom, vUv - vec2(bt.x, -bt.y))).rgb * 0.25 * uBloomGain;
    c = c + bloom * (1.0 - c * 0.5);
    // The light in the air (the projector's beam), already stopped at whatever the eye sees first.
    c += texture2D(uVolume, vUv).rgb;
    vec2 q = vUv - 0.5;
    q.x *= uResolution.x / uResolution.y;
    float vignette = 1.0 - uVignette * smoothstep(0.3, 1.15, length(q));
    c *= vignette;
    // Grain on a 1.5-pixel cell, weaker in the highlights as on film.
    float g = hash12(floor(gl_FragCoord.xy / 1.5) + fract(uTime * 7.13) * 917.0) - 0.5;
    c += g * uGrain * (0.35 + 0.65 * (1.0 - c)) * cover;
    // Premultiplied, and no colour beyond the coverage: the beam, the dust, the bloom and the blur add
    // nothing over the user's picture, which shows exactly as on the player page.
    gl_FragColor = vec4(min(c, vec3(cover)), cover);
}
`;

/**
 * `volume` draws the light in the air (the beam) at half size after the hall, from the hall's depth, so it
 * stops at the first thing the eye sees: it gets uDepth, uInvProj and uEye here.
 */
export const createCinemaPost = (volume: THREE.ShaderMaterial): CinemaPost => {
    const target = (samples: number, depth: boolean, float = false) => new THREE.WebGLRenderTarget(1, 1, {
        samples,
        depthBuffer: depth,
        stencilBuffer: false,
        type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
    });
    const main = target(4, true);
    main.depthTexture = new THREE.DepthTexture(1, 1);
    const depthUniforms = () => ({
        uDepth: { value: main.depthTexture },
        uInvProj: { value: new THREE.Matrix4() },
        uFocus: { value: 14 },
        uAperture: { value: 0.1 },
    });
    // The blurred copies keep half floats: blurred 8-bit darks would band. Only the multisampled target is 8-bit.
    const half = [target(0, false, true), target(0, false, true)];
    const quarter = [target(0, false, true), target(0, false, true)];
    const bloom = [target(0, false, true), target(0, false, true)];
    const air = target(0, false, true);
    const targets = [main, ...half, ...quarter, ...bloom, air];
    Object.assign(volume.uniforms, depthUniforms(), { uEye: { value: new THREE.Vector3() } });

    const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
    });
    const down = material(DOWN_FRAGMENT, { ...depthUniforms(), uSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uBright: { value: 0 }, uFromDepth: { value: 0 } });
    const blur = material(BLUR_FRAGMENT, { uSource: { value: null }, uStep: { value: new THREE.Vector2() } });
    const composite = material(COMPOSITE_FRAGMENT, {
        ...depthUniforms(),
        uSharp: { value: main.texture },
        uSoft: { value: half[0].texture },
        uSofter: { value: quarter[0].texture },
        uBloom: { value: bloom[0].texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uGrain: { value: 0 },
        uVignette: { value: 0 },
        uBloomGain: { value: 0 },
        uVolume: { value: air.texture },
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(geometry, down);
    quad.frustumCulled = false;
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const size = new THREE.Vector2();
    let width = 0;
    let height = 0;

    const pass = (renderer: THREE.WebGLRenderer, shader: THREE.ShaderMaterial, into: THREE.WebGLRenderTarget | null) => {
        quad.material = shader;
        renderer.setRenderTarget(into);
        renderer.render(quad, quadCamera);
    };
    const downInto = (renderer: THREE.WebGLRenderer, from: THREE.WebGLRenderTarget, into: THREE.WebGLRenderTarget, bright: boolean) => {
        down.uniforms.uSource.value = from.texture;
        (down.uniforms.uTexel.value as THREE.Vector2).set(1 / from.width, 1 / from.height);
        down.uniforms.uBright.value = bright ? 1 : 0;
        down.uniforms.uFromDepth.value = from === main ? 1 : 0;
        pass(renderer, down, into);
    };
    /** Blurs pair[0] in place through pair[1], `spread` texels between taps. */
    const blurPair = (renderer: THREE.WebGLRenderer, pair: THREE.WebGLRenderTarget[], spread: number) => {
        blur.uniforms.uSource.value = pair[0].texture;
        (blur.uniforms.uStep.value as THREE.Vector2).set(spread / pair[0].width, 0);
        pass(renderer, blur, pair[1]);
        blur.uniforms.uSource.value = pair[1].texture;
        (blur.uniforms.uStep.value as THREE.Vector2).set(0, spread / pair[0].height);
        pass(renderer, blur, pair[0]);
    };

    const render = (renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, frame: CinemaPostFrame) => {
        renderer.getDrawingBufferSize(size);
        if (size.x !== width || size.y !== height) {
            width = size.x;
            height = size.y;
            main.setSize(width, height);
            const halfW = Math.max(1, Math.floor(width / 2));
            const halfH = Math.max(1, Math.floor(height / 2));
            [...half, air].forEach(item => item.setSize(halfW, halfH));
            [...quarter, ...bloom].forEach(item => item.setSize(Math.max(1, Math.floor(halfW / 2)), Math.max(1, Math.floor(halfH / 2))));
        }
        const autoClear = renderer.autoClear;
        renderer.autoClear = true;
        // Cleared opaque: only a surface that writes alpha 0 makes a hole.
        renderer.setClearColor(0x000000, 1);
        renderer.setRenderTarget(main);
        renderer.render(scene, camera);
        [down, composite, volume].forEach(item => {
            (item.uniforms.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
            item.uniforms.uFocus.value = frame.focus;
            item.uniforms.uAperture.value = frame.aperture;
        });
        (volume.uniforms.uEye.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
        pass(renderer, volume, air);

        downInto(renderer, main, half[0], false);
        downInto(renderer, half[0], bloom[0], true);
        blurPair(renderer, half, 1.4);
        downInto(renderer, half[0], quarter[0], false);
        blurPair(renderer, quarter, 1.6);
        blurPair(renderer, bloom, 1.5);
        blurPair(renderer, bloom, 3.2);

        (composite.uniforms.uResolution.value as THREE.Vector2).set(width, height);
        composite.uniforms.uTime.value = frame.time;
        composite.uniforms.uGrain.value = frame.grain;
        composite.uniforms.uVignette.value = frame.vignette;
        composite.uniforms.uBloomGain.value = frame.bloom;
        pass(renderer, composite, null);
        renderer.autoClear = autoClear;
    };

    // A program's key holds the colour space of where it draws: the scene and the blur passes draw into
    // targets, the composite onto the canvas, so each is compiled with that target bound.
    const compile = async (renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera) => {
        const passes = new THREE.Scene();
        [down, blur, volume].forEach(shader => passes.add(new THREE.Mesh(geometry, shader)));
        renderer.setRenderTarget(main);
        const intoTargets = [renderer.compileAsync(scene, camera), renderer.compileAsync(passes, quadCamera)];
        renderer.setRenderTarget(null);
        await Promise.all([...intoTargets, renderer.compileAsync(new THREE.Mesh(geometry, composite), quadCamera)]);
    };

    const dispose = () => {
        targets.forEach(item => item.dispose());
        [down, blur, composite].forEach(item => item.dispose());
        geometry.dispose();
    };

    return { render, compile, dispose };
};
