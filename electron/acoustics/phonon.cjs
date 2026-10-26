const fs = require('fs');
const os = require('os');
const path = require('path');

// electron/acoustics/phonon.cjs
// Steam Audio 4.8.1 through koffi: a room (RoomRequest of src/services/sceneSound/acousticsTypes.ts) in, the
// 4-channel true-stereo IR the renderer's ConvolverNode takes out:
//   [L speaker -> L ear, L speaker -> R ear, R speaker -> L ear, R speaker -> R ear]
// Each speaker is a source; its direct sound and its reflections are rendered by sending a unit impulse through
// Steam Audio's own effects (headphones: HRTF; speakers: plain panning), then placed at that speaker's own delay.
// Ported from the prototype (proto/scene-sound, dev/proto/scene-sound/phonon.cjs, REPORT.md).
//
// Plain node, no 'electron': worker.cjs requires it in its utility process, tests from anywhere. koffi and the
// library are loaded only when a room is computed, so the pure parts below load without either.

const STEAM_AUDIO_VERSION = '4.8.1';
const API_VERSION = (4 << 16) | (8 << 8) | 1;
const FRAME = 1024;
/** Steam Audio's own speed of sound (m/s). */
const SPEED_OF_SOUND = 340;

/**
 * How the room is simulated. The prototype's listening set (scene-irs.cjs): 32768 rays, 128 bounces (64 to 512
 * measured the same in the hall), ambisonic order 3, 2 s. bassCutoffHz: reflections fade out below it (ray
 * tracing cannot model room modes); the owner tunes it by ear (decision 20:04, item 2), so it is a parameter and
 * goes into the cache header. RoomRequest has no field for it yet.
 */
const DEFAULTS = { rays: 32768, bounces: 128, order: 3, duration: 2, diffuse: 32, bassCutoffHz: 200 };

/** The library's file name on each platform. */
const LIBRARY_FILES = { win32: 'phonon.dll', darwin: 'libphonon.dylib', linux: 'libphonon.so' };

/**
 * Where the library is: resources/steam-audio in a packaged app, build/steam-audio/<os>-<arch> (filled by
 * build/fetchSteamAudio.mjs) in a dev run. Null when this platform has no library or the file is not there.
 */
const steamAudioLibraryPath = ({ packaged, resourcesPath, appRoot, platform = process.platform, arch = process.arch }) => {
    const file = LIBRARY_FILES[platform];
    if (!file) return null;
    const osName = { darwin: 'mac', win32: 'win' }[platform] ?? platform;
    const full = packaged
        ? path.join(resourcesPath, 'steam-audio', file)
        : path.join(appRoot, 'build', 'steam-audio', `${osName}-${arch}`, file);
    return fs.statSync(full, { throwIfNoEntry: false })?.isFile() ? full : null;
};

// --- the request, checked before it reaches the library ------------------------------------------------

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const inUnit = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const MAX_TRIANGLES = 2_000_000;

/**
 * Throws with what is wrong when `request` is not a RoomRequest the library can take. It comes from a renderer,
 * and a triangle index past the vertices would be read by native code.
 */
const validateRoomRequest = (request) => {
    const fail = (what) => { throw new Error(`bad room request: ${what}`); };
    if (!request || typeof request !== 'object') fail('not an object');
    const { key, meshes, materials, speakers, listener, output, sampleRate } = request;
    if (typeof key !== 'string' || !key || key.length > 1024) fail('key');
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) fail('sampleRate');
    if (output !== 'headphones' && output !== 'speakers') fail('output');
    if (!Array.isArray(speakers) || speakers.length !== 2 || !speakers.every(isVec3)) fail('speakers');
    if (!listener || ![listener.position, listener.forward, listener.up].every(isVec3)) fail('listener');
    if (!(Math.hypot(...cross(listener.forward, listener.up)) > 1e-6)) fail('listener forward and up are parallel or zero');
    if (!Array.isArray(materials) || !materials.length || materials.length > 65536) fail('materials');
    materials.forEach((m, i) => {
        const ok = m && Array.isArray(m.absorption) && m.absorption.length === 3 && m.absorption.every(inUnit)
            && inUnit(m.scattering) && Array.isArray(m.transmission) && m.transmission.length === 3 && m.transmission.every(inUnit);
        if (!ok) fail(`material ${i}`);
    });
    if (!Array.isArray(meshes) || !meshes.length) fail('meshes');
    let triangles = 0;
    meshes.forEach((mesh, i) => {
        const { positions, indices, triangleMaterials } = mesh ?? {};
        if (!(positions instanceof Float32Array) || !positions.length || positions.length % 3 || !positions.every(Number.isFinite)) fail(`mesh ${i} positions`);
        if (!(indices instanceof Uint32Array) || !indices.length || indices.length % 3) fail(`mesh ${i} indices`);
        const vertices = positions.length / 3;
        if (indices.some(index => index >= vertices)) fail(`mesh ${i} index past its vertices`);
        if (!(triangleMaterials instanceof Uint16Array) || triangleMaterials.length !== indices.length / 3) fail(`mesh ${i} triangleMaterials`);
        if (triangleMaterials.some(m => m >= materials.length)) fail(`mesh ${i} material past the table`);
        triangles += indices.length / 3;
    });
    if (triangles > MAX_TRIANGLES) fail(`${triangles} triangles, more than ${MAX_TRIANGLES}`);
};

// --- the IR from the rendered parts (pure) ---------------------------------------------------------------

/** In-place 2nd-order Butterworth high-pass (RBJ cookbook); `hz` <= 0 leaves `x` as it is. */
const highPass = (x, hz, sampleRate) => {
    if (!(hz > 0)) return x;
    const w = 2 * Math.PI * hz / sampleRate; const alpha = Math.sin(w) / (2 * Math.SQRT1_2); const cos = Math.cos(w);
    const a0 = 1 + alpha;
    const b0 = (1 + cos) / 2 / a0; const b1 = -(1 + cos) / a0; const b2 = b0;
    const a1 = -2 * cos / a0; const a2 = (1 - alpha) / a0;
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < x.length; i += 1) {
        const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
    }
    return x;
};

/** Adds `from` into `out` with from[i] landing on out[at + i]; what falls outside `out` is dropped. */
const addAt = (out, from, at) => {
    for (let i = Math.max(0, -at); i < from.length && at + i < out.length; i += 1) out[at + i] += from[i];
};

/**
 * The true-stereo IR from each speaker's rendered parts.
 *
 * perSpeaker: [left, right], each { dry: [Lear, Rear], wet: [Lear, Rear], delay } - dry the direct sound, wet the
 * reflections (Steam Audio starts them at that speaker's own direct arrival, reflection_simulator.cpp:519 of
 * 4.8.1), delay the direct path in samples. lead: the samples Steam Audio's effects answer an impulse late (256
 * with HRTF). Both come out, and so does the delay the two speakers share: the nearer one's direct sound lands
 * on sample 0. The reflections are high-passed at bassCutoffHz and the last 50 ms fade out.
 */
const assembleIR = ({ perSpeaker, lead, irSize, sampleRate, bassCutoffHz }) => {
    const shift = Math.min(...perSpeaker.map(s => s.delay));
    const channels = [0, 1, 2, 3].map(() => new Float32Array(irSize));
    perSpeaker.forEach((s, speaker) => {
        const at = s.delay - shift - lead;
        for (let ear = 0; ear < 2; ear += 1) {
            const out = channels[speaker * 2 + ear];
            addAt(out, highPass(Float32Array.from(s.wet[ear]), bassCutoffHz, sampleRate), at);
            addAt(out, s.dry[ear], at);
        }
    });
    const fade = Math.min(irSize, Math.round(0.05 * sampleRate)); // raised cosine
    for (const out of channels) for (let i = 0; i < fade; i += 1) out[irSize - fade + i] *= 0.5 * (1 + Math.cos(Math.PI * (i + 1) / fade));
    return channels;
};

/** The first sample whose magnitude passes 1e-6, or -1. */
const onsetOf = (x) => x.findIndex(v => Math.abs(v) > 1e-6);

// --- the library ----------------------------------------------------------------------------------------

let api = null;
/** Binds the subset used here, once per process. Throws when the library cannot be loaded. */
const bind = (libraryFile) => {
    if (api) return api;
    if (!libraryFile) throw new Error('no Steam Audio library for this platform (run `npm run steam-audio:fetch`)');
    const koffi = require('koffi');
    const lib = koffi.load(libraryFile);
    const P = koffi.pointer;
    const OUTH = koffi.out(P('void *'));
    const INOUTH = koffi.inout(P('void *'));
    const f3 = koffi.array('float', 3);
    const Vec3 = koffi.struct('IPLVector3', { x: 'float', y: 'float', z: 'float' });
    const Space = koffi.struct('IPLCoordinateSpace3', { right: Vec3, up: Vec3, ahead: Vec3, origin: Vec3 });
    const Sphere = koffi.struct('IPLSphere', { center: Vec3, radius: 'float' });
    const ContextSettings = koffi.struct('IPLContextSettings', { version: 'uint32', logCallback: 'void *', allocateCallback: 'void *', freeCallback: 'void *', simdLevel: 'int', flags: 'int' });
    const AudioSettings = koffi.struct('IPLAudioSettings', { samplingRate: 'int', frameSize: 'int' });
    const AudioBuffer = koffi.struct('IPLAudioBuffer', { numChannels: 'int', numSamples: 'int', data: 'void *' });
    const HRTFSettings = koffi.struct('IPLHRTFSettings', { type: 'int', sofaFileName: 'const char *', sofaData: 'void *', sofaDataSize: 'int', volume: 'float', normType: 'int' });
    const SceneSettings = koffi.struct('IPLSceneSettings', { type: 'int', closestHitCallback: 'void *', anyHitCallback: 'void *', batchedClosestHitCallback: 'void *', batchedAnyHitCallback: 'void *', userData: 'void *', embreeDevice: 'void *', radeonRaysDevice: 'void *' });
    // IPLVector3*, IPLTriangle* and IPLMaterial* are plain runs of float/int, so typed arrays go in as they are.
    const StaticMeshSettings = koffi.struct('IPLStaticMeshSettings', { numVertices: 'int', numTriangles: 'int', numMaterials: 'int', vertices: 'float *', triangles: 'int *', materialIndices: 'int *', materials: 'float *' });
    const DistanceModel = koffi.struct('IPLDistanceAttenuationModel', { type: 'int', minDistance: 'float', callback: 'void *', userData: 'void *', dirty: 'int' });
    const AirModel = koffi.struct('IPLAirAbsorptionModel', { type: 'int', coefficients: f3, callback: 'void *', userData: 'void *', dirty: 'int' });
    const Directivity = koffi.struct('IPLDirectivity', { dipoleWeight: 'float', dipolePower: 'float', callback: 'void *', userData: 'void *' });
    const BakedId = koffi.struct('IPLBakedDataIdentifier', { type: 'int', variation: 'int', endpointInfluence: Sphere });
    const SimSettings = koffi.struct('IPLSimulationSettings', { flags: 'int', sceneType: 'int', reflectionType: 'int', maxNumOcclusionSamples: 'int', maxNumRays: 'int', numDiffuseSamples: 'int', maxDuration: 'float', maxOrder: 'int', maxNumSources: 'int', numThreads: 'int', rayBatchSize: 'int', numVisSamples: 'int', samplingRate: 'int', frameSize: 'int', openCLDevice: 'void *', radeonRaysDevice: 'void *', tanDevice: 'void *' });
    const SourceSettings = koffi.struct('IPLSourceSettings', { flags: 'int' });
    const SimInputs = koffi.struct('IPLSimulationInputs', { flags: 'int', directFlags: 'int', source: Space, distanceAttenuationModel: DistanceModel, airAbsorptionModel: AirModel, directivity: Directivity, occlusionType: 'int', occlusionRadius: 'float', numOcclusionSamples: 'int', reverbScale: f3, hybridReverbTransitionTime: 'float', hybridReverbOverlapPercent: 'float', baked: 'int', bakedDataIdentifier: BakedId, pathingProbes: 'void *', visRadius: 'float', visThreshold: 'float', visRange: 'float', pathingOrder: 'int', enableValidation: 'int', findAlternatePaths: 'int', numTransmissionRays: 'int', deviationModel: 'void *' });
    const SharedInputs = koffi.struct('IPLSimulationSharedInputs', { listener: Space, numRays: 'int', numBounces: 'int', duration: 'float', order: 'int', irradianceMinDistance: 'float', pathingVisCallback: 'void *', pathingUserData: 'void *' });
    const DirectParams = koffi.struct('IPLDirectEffectParams', { flags: 'int', transmissionType: 'int', distanceAttenuation: 'float', airAbsorption: f3, directivity: 'float', occlusion: 'float', transmission: f3 });
    const ReflParams = koffi.struct('IPLReflectionEffectParams', { type: 'int', ir: 'void *', reverbTimes: f3, eq: f3, delay: 'int', numChannels: 'int', irSize: 'int', tanDevice: 'void *', tanSlot: 'int' });
    const PathParams = koffi.struct('IPLPathEffectParams', { eqCoeffs: f3, shCoeffs: 'void *', order: 'int', binaural: 'int', hrtf: 'void *', listener: Space, normalizeEQ: 'int' });
    const SimOutputs = koffi.struct('IPLSimulationOutputs', { direct: DirectParams, reflections: ReflParams, pathing: PathParams });
    const ReflSettings = koffi.struct('IPLReflectionEffectSettings', { type: 'int', irSize: 'int', numChannels: 'int' });
    const SpeakerLayout = koffi.struct('IPLSpeakerLayout', { type: 'int', numSpeakers: 'int', speakers: 'void *' });
    const DecodeSettings = koffi.struct('IPLAmbisonicsDecodeEffectSettings', { speakerLayout: SpeakerLayout, hrtf: 'void *', maxOrder: 'int' });
    const DecodeParams = koffi.struct('IPLAmbisonicsDecodeEffectParams', { order: 'int', hrtf: 'void *', orientation: Space, binaural: 'int' });
    const DirectSettings = koffi.struct('IPLDirectEffectSettings', { numChannels: 'int' });
    const BinauralSettings = koffi.struct('IPLBinauralEffectSettings', { hrtf: 'void *' });
    const BinauralParams = koffi.struct('IPLBinauralEffectParams', { direction: Vec3, interpolation: 'int', spatialBlend: 'float', hrtf: 'void *', peakDelays: 'void *' });
    const PanningSettings = koffi.struct('IPLPanningEffectSettings', { speakerLayout: SpeakerLayout });
    const PanningParams = koffi.struct('IPLPanningEffectParams', { direction: Vec3 });
    const fn = (name, ret, args) => lib.func(name, ret, args);
    const release = (name) => fn(name, 'void', [INOUTH]);
    api = {
        contextCreate: fn('iplContextCreate', 'int', [P(ContextSettings), OUTH]),
        hrtfCreate: fn('iplHRTFCreate', 'int', ['void *', P(AudioSettings), P(HRTFSettings), OUTH]),
        embreeCreate: fn('iplEmbreeDeviceCreate', 'int', ['void *', 'void *', OUTH]),
        sceneCreate: fn('iplSceneCreate', 'int', ['void *', P(SceneSettings), OUTH]),
        sceneRelease: release('iplSceneRelease'),
        staticMeshCreate: fn('iplStaticMeshCreate', 'int', ['void *', P(StaticMeshSettings), OUTH]),
        staticMeshRelease: release('iplStaticMeshRelease'),
        staticMeshAdd: fn('iplStaticMeshAdd', 'void', ['void *', 'void *']),
        sceneCommit: fn('iplSceneCommit', 'void', ['void *']),
        simulatorCreate: fn('iplSimulatorCreate', 'int', ['void *', P(SimSettings), OUTH]),
        simulatorRelease: release('iplSimulatorRelease'),
        simulatorSetScene: fn('iplSimulatorSetScene', 'void', ['void *', 'void *']),
        simulatorCommit: fn('iplSimulatorCommit', 'void', ['void *']),
        sourceCreate: fn('iplSourceCreate', 'int', ['void *', P(SourceSettings), OUTH]),
        sourceRelease: release('iplSourceRelease'),
        sourceAdd: fn('iplSourceAdd', 'void', ['void *', 'void *']),
        sourceSetInputs: fn('iplSourceSetInputs', 'void', ['void *', 'int', P(SimInputs)]),
        setSharedInputs: fn('iplSimulatorSetSharedInputs', 'void', ['void *', 'int', P(SharedInputs)]),
        runDirect: fn('iplSimulatorRunDirect', 'void', ['void *']),
        runReflections: fn('iplSimulatorRunReflections', 'void', ['void *']),
        sourceGetOutputs: fn('iplSourceGetOutputs', 'void', ['void *', 'int', koffi.out(P(SimOutputs))]),
        relativeDirection: fn('iplCalculateRelativeDirection', Vec3, ['void *', Vec3, Vec3, Vec3, Vec3]),
        bufferAllocate: fn('iplAudioBufferAllocate', 'int', ['void *', 'int', 'int', koffi.out(P(AudioBuffer))]),
        bufferFree: fn('iplAudioBufferFree', 'void', ['void *', P(AudioBuffer)]),
        interleave: fn('iplAudioBufferInterleave', 'void', ['void *', P(AudioBuffer), 'float *']),
        deinterleave: fn('iplAudioBufferDeinterleave', 'void', ['void *', 'float *', P(AudioBuffer)]),
        reflectionCreate: fn('iplReflectionEffectCreate', 'int', ['void *', P(AudioSettings), P(ReflSettings), OUTH]),
        reflectionRelease: release('iplReflectionEffectRelease'),
        reflectionApply: fn('iplReflectionEffectApply', 'int', ['void *', P(ReflParams), P(AudioBuffer), P(AudioBuffer), 'void *']),
        decodeCreate: fn('iplAmbisonicsDecodeEffectCreate', 'int', ['void *', P(AudioSettings), P(DecodeSettings), OUTH]),
        decodeRelease: release('iplAmbisonicsDecodeEffectRelease'),
        decodeApply: fn('iplAmbisonicsDecodeEffectApply', 'int', ['void *', P(DecodeParams), P(AudioBuffer), P(AudioBuffer)]),
        directCreate: fn('iplDirectEffectCreate', 'int', ['void *', P(AudioSettings), P(DirectSettings), OUTH]),
        directRelease: release('iplDirectEffectRelease'),
        directApply: fn('iplDirectEffectApply', 'int', ['void *', P(DirectParams), P(AudioBuffer), P(AudioBuffer)]),
        binauralCreate: fn('iplBinauralEffectCreate', 'int', ['void *', P(AudioSettings), P(BinauralSettings), OUTH]),
        binauralRelease: release('iplBinauralEffectRelease'),
        binauralApply: fn('iplBinauralEffectApply', 'int', ['void *', P(BinauralParams), P(AudioBuffer), P(AudioBuffer)]),
        panningCreate: fn('iplPanningEffectCreate', 'int', ['void *', P(AudioSettings), P(PanningSettings), OUTH]),
        panningRelease: release('iplPanningEffectRelease'),
        panningApply: fn('iplPanningEffectApply', 'int', ['void *', P(PanningParams), P(AudioBuffer), P(AudioBuffer)]),
    };
    return api;
};

/** Calls a Steam Audio create function and returns the handle, or throws with its status. */
const create = (name, call) => {
    const handle = [null];
    const status = call(handle);
    if (status !== 0 || !handle[0]) throw new Error(`${name} failed with IPLerror ${status}`);
    return handle[0];
};

/** What lives as long as the process: the context, the Embree device (null where it cannot be made), an HRTF per rate. */
let shared = null;
const sharedFor = (a) => {
    if (shared) return shared;
    const context = create('iplContextCreate', h => a.contextCreate({ version: API_VERSION, logCallback: null, allocateCallback: null, freeCallback: null, simdLevel: 4, flags: 0 }, h));
    let embree = null;
    try {
        embree = create('iplEmbreeDeviceCreate', h => a.embreeCreate(context, Buffer.alloc(8), h));
    } catch (error) {
        console.warn(`[acoustics] no Embree, using Steam Audio's own ray tracer: ${error.message}`);
    }
    shared = { context, embree, hrtfs: new Map() };
    return shared;
};

/** Loads the library and makes its context; throws with the reason when that fails. */
const load = (libraryFile) => sharedFor(bind(libraryFile));

const vec = ([x, y, z]) => ({ x, y, z });
const normalize = ([x, y, z]) => { const d = Math.hypot(x, y, z) || 1; return [x / d, y / d, z / d]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Steam Audio's coordinate space (right-handed, Y up, like the request) from a position, forward and up. */
const space = (origin, forward, up) => {
    const ahead = normalize(forward);
    const right = normalize(cross(ahead, up));
    return { right: vec(right), up: vec(cross(right, ahead)), ahead: vec(ahead), origin: vec(origin) };
};

/**
 * Sends a unit impulse through `chain` (Steam Audio effects, buffers.in -> buffers.out) and returns `length`
 * samples of each output channel. Two silent frames go first so no effect is still fading in from its empty state.
 */
const impulseThrough = (a, context, buffers, chain, length) => {
    const warm = 2;
    const frames = warm + Math.ceil(length / FRAME);
    const outCount = buffers.out.numChannels;
    const result = Array.from({ length: outCount }, () => new Float32Array(frames * FRAME));
    const input = new Float32Array(FRAME); const output = new Float32Array(FRAME * outCount);
    for (let frame = 0; frame < frames; frame += 1) {
        input.fill(0);
        if (frame === warm) input[0] = 1;
        a.deinterleave(context, input, buffers.in);
        chain();
        a.interleave(context, buffers.out, output);
        for (let i = 0; i < FRAME; i += 1) for (let ch = 0; ch < outCount; ch += 1) result[ch][frame * FRAME + i] = output[i * outCount + ch];
    }
    return result.map(ch => ch.subarray(warm * FRAME, warm * FRAME + length));
};

/**
 * Simulates the room and renders each speaker's parts: { perSpeaker: [{ dry, wet, delay }], lead, irSize }.
 * Everything made for this request is released before it returns.
 */
const simulateSpeakers = async (libraryFile, request, settings) => {
    const o = { ...DEFAULTS, threads: Math.max(1, Math.min(8, os.availableParallelism() - 1)), ...settings };
    const a = bind(libraryFile);
    const { context, embree, hrtfs } = sharedFor(a);
    const rate = request.sampleRate;
    const audio = { samplingRate: rate, frameSize: FRAME };
    if (!hrtfs.has(rate)) hrtfs.set(rate, create('iplHRTFCreate', h => a.hrtfCreate(context, audio, { type: 0, sofaFileName: null, sofaData: null, sofaDataSize: 0, volume: 1, normType: 0 }, h)));
    const hrtf = hrtfs.get(rate);
    const headphones = request.output === 'headphones';
    const irSize = Math.round(o.duration * rate);
    const ambiChannels = (o.order + 1) ** 2;
    const owned = []; // release calls, run in reverse in `finally`
    const make = (name, call, releaseCall) => { const handle = create(name, call); owned.push(() => releaseCall([handle])); return handle; };
    try {
        const scene = make('iplSceneCreate', h => a.sceneCreate(context, { type: embree ? 1 : 0, closestHitCallback: null, anyHitCallback: null, batchedClosestHitCallback: null, batchedAnyHitCallback: null, userData: null, embreeDevice: embree, radeonRaysDevice: null }, h), a.sceneRelease);
        const materials = Float32Array.from(request.materials.flatMap(m => [...m.absorption, m.scattering, ...m.transmission]));
        for (const mesh of request.meshes) {
            const handle = make('iplStaticMeshCreate', h => a.staticMeshCreate(scene, {
                numVertices: mesh.positions.length / 3, numTriangles: mesh.indices.length / 3, numMaterials: request.materials.length,
                vertices: mesh.positions, triangles: Int32Array.from(mesh.indices), materialIndices: Int32Array.from(mesh.triangleMaterials), materials,
            }, h), a.staticMeshRelease);
            a.staticMeshAdd(handle, scene);
        }
        a.sceneCommit(scene);
        const sim = make('iplSimulatorCreate', h => a.simulatorCreate(context, {
            flags: 3, sceneType: embree ? 1 : 0, reflectionType: 0, maxNumOcclusionSamples: 16, maxNumRays: o.rays, numDiffuseSamples: o.diffuse,
            maxDuration: o.duration, maxOrder: o.order, maxNumSources: 2, numThreads: o.threads, rayBatchSize: 1, numVisSamples: 0,
            samplingRate: rate, frameSize: FRAME, openCLDevice: null, radeonRaysDevice: null, tanDevice: null,
        }, h), a.simulatorRelease);
        a.simulatorSetScene(sim, scene);
        const sources = request.speakers.map(() => {
            const source = make('iplSourceCreate', h => a.sourceCreate(sim, { flags: 3 }, h), a.sourceRelease);
            a.sourceAdd(source, sim);
            return source;
        });
        const { position: ear, forward, up } = request.listener;
        const listener = space(ear, forward, up);
        request.speakers.forEach((position, index) => a.sourceSetInputs(sources[index], 3, {
            flags: 3, directFlags: 1 | 2 | 8 | 16, source: space(position, [0, 0, 1], [0, 1, 0]),
            distanceAttenuationModel: { type: 0, minDistance: 1, callback: null, userData: null, dirty: 0 },
            airAbsorptionModel: { type: 0, coefficients: [0, 0, 0], callback: null, userData: null, dirty: 0 },
            directivity: { dipoleWeight: 0, dipolePower: 1, callback: null, userData: null },
            occlusionType: 0, occlusionRadius: 0, numOcclusionSamples: 1, reverbScale: [1, 1, 1],
            hybridReverbTransitionTime: 1, hybridReverbOverlapPercent: 0.25, baked: 0,
            bakedDataIdentifier: { type: 0, variation: 0, endpointInfluence: { center: vec([0, 0, 0]), radius: 0 } },
            pathingProbes: null, visRadius: 0, visThreshold: 0, visRange: 0, pathingOrder: 1, enableValidation: 0, findAlternatePaths: 0,
            numTransmissionRays: 1, deviationModel: null,
        }));
        a.setSharedInputs(sim, 3, { listener, numRays: o.rays, numBounces: o.bounces, duration: o.duration, order: o.order, irradianceMinDistance: 1, pathingVisCallback: null, pathingUserData: null });
        a.simulatorCommit(sim);
        a.runDirect(sim);
        await new Promise((resolve, reject) => a.runReflections.async(sim, error => (error ? reject(error) : resolve())));

        const stereoLayout = { type: 1, numSpeakers: 2, speakers: null };
        const reflection = make('iplReflectionEffectCreate', h => a.reflectionCreate(context, audio, { type: 0, irSize, numChannels: ambiChannels }, h), a.reflectionRelease);
        const decode = make('iplAmbisonicsDecodeEffectCreate', h => a.decodeCreate(context, audio, { speakerLayout: stereoLayout, hrtf, maxOrder: o.order }, h), a.decodeRelease);
        const direct = make('iplDirectEffectCreate', h => a.directCreate(context, audio, { numChannels: 1 }, h), a.directRelease);
        const toEars = headphones
            ? make('iplBinauralEffectCreate', h => a.binauralCreate(context, audio, { hrtf }, h), a.binauralRelease)
            : make('iplPanningEffectCreate', h => a.panningCreate(context, audio, { speakerLayout: stereoLayout }, h), a.panningRelease);
        const buffer = (channels) => {
            const out = {};
            if (a.bufferAllocate(context, channels, FRAME, out) !== 0) throw new Error('iplAudioBufferAllocate failed');
            owned.push(() => a.bufferFree(context, out));
            return out;
        };
        const mono = buffer(1); const mono2 = buffer(1); const ambi = buffer(ambiChannels); const stereo = buffer(2);

        // Each speaker's outputs are read right after the simulation: read twice without one, the reflections
        // differ (prototype trap 4).
        const perSpeaker = request.speakers.map((position, index) => {
            const outputs = {};
            a.sourceGetOutputs(sources[index], 3, outputs);
            const reflParams = { ...outputs.reflections, type: 0, numChannels: ambiChannels, irSize };
            const decodeParams = { order: o.order, hrtf, orientation: listener, binaural: headphones ? 1 : 0 };
            const wet = impulseThrough(a, context, { in: mono, out: stereo }, () => {
                a.reflectionApply(reflection, reflParams, mono, ambi, null);
                a.decodeApply(decode, decodeParams, ambi, stereo);
            }, irSize + 2 * FRAME);
            const directParams = { ...outputs.direct, flags: 1 | 2 | 8 | 16, transmissionType: 1 };
            const direction = a.relativeDirection(context, vec(position), listener.origin, listener.ahead, listener.up);
            const earsFrom = (input) => (headphones
                ? a.binauralApply(toEars, { direction, interpolation: 1, spatialBlend: 1, hrtf, peakDelays: null }, input, stereo)
                : a.panningApply(toEars, { direction }, input, stereo));
            const dry = impulseThrough(a, context, { in: mono, out: stereo }, () => {
                a.directApply(direct, directParams, mono, mono2);
                earsFrom(mono2);
            }, FRAME);
            // The ear effect alone, at full level: where its answer starts even when the direct sound is blocked.
            const onset = Math.min(...impulseThrough(a, context, { in: mono, out: stereo }, () => earsFrom(mono), FRAME).map(onsetOf).filter(i => i >= 0));
            const distance = Math.hypot(position[0] - ear[0], position[1] - ear[1], position[2] - ear[2]);
            return { wet, dry, onset, delay: Math.round(distance / SPEED_OF_SOUND * rate) };
        });
        // The effects' latency (prototype trap 2: 256 samples with HRTF): where the earliest ear first hears a speaker.
        const onsets = perSpeaker.map(s => s.onset).filter(Number.isFinite);
        const lead = onsets.length ? Math.min(...onsets) : 0;
        return { perSpeaker, lead, irSize, bassCutoffHz: o.bassCutoffHz };
    } finally {
        for (const releaseOne of owned.reverse()) releaseOne();
    }
};

/** The room's IR, in RoomResult.channels order. Throws when the library cannot run it. */
const computeRoomIR = async (libraryFile, request, settings = {}) => {
    const { perSpeaker, lead, irSize, bassCutoffHz } = await simulateSpeakers(libraryFile, request, settings);
    return assembleIR({ perSpeaker, lead, irSize, sampleRate: request.sampleRate, bassCutoffHz });
};

module.exports = {
    STEAM_AUDIO_VERSION, DEFAULTS, LIBRARY_FILES,
    steamAudioLibraryPath, validateRoomRequest, assembleIR, onsetOf, load, simulateSpeakers, computeRoomIR,
};
