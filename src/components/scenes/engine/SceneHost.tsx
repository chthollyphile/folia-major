import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from '../../../types/visualizerModes';
import VisualizerRenderer from '../../visualizer/VisualizerRenderer';
import { VISUALIZER_BACKGROUND_REGISTRY } from '../../visualizer/backgrounds/registry';
import { VISUALIZER_REGISTRY } from '../../visualizer/registry';
import type { SceneAnchor, SceneContext, SceneDefinition, SceneRuntime, ScreenQuad } from '../definition';
import { useChosenScene } from '../registry';
import { useSceneSettingsStore } from '../settings/useSceneSettingsStore';
import { createSceneEventBus } from './sceneEvents';
import { onQueueEnd } from './queueEnd';
import { planSceneLayers, resolveSceneOffered, sceneOffersBackground, sceneOffersLyricStyle } from './scenePlacement';
import { createSceneSignals, diffSceneSignals, trackPointer, type SceneSignalSnapshot } from './sceneSignals';
import { silentSceneSound } from './sceneSound';
import { quadToMatrix3d } from './surfaceQuad';

// src/components/scenes/engine/SceneHost.tsx
// 场景宿主：播放页上挂 VisualizerRenderer 的地方换成它。没选场景时它就是原来那个 VisualizerRenderer，一模一样；
// 选了场景时它加载场景、每帧推进、把信号和事件交给场景，把借来的歌词样式和背景放到表面盒子里（盒子里是一个没改过的 VisualizerRenderer）。
// 场景加载失败、运行中抛错、WebGL 丢了两次，都回到用户原来的歌词样式，播放页不会黑掉。

type RendererProps = React.ComponentProps<typeof VisualizerRenderer>;

/** How long the host waits for the scene's ready() before showing it anyway. */
const READY_LIMIT_MS = 4000;
/** The longest step a frame hands the scene (seconds): a frame after a stall does not leap. */
const MAX_FRAME_DT = 0.1;

type StageStatus = 'loading' | 'running' | 'failed';

const valuesOf = (sceneId: string) => useSceneSettingsStore.getState().sceneOptions[sceneId]?.values;

/** Runs one scene; the user's lyric style stands in while it loads and takes over for good when it fails. */
const SceneStage: React.FC<{ definition: SceneDefinition; rendererProps: RendererProps }> = ({ definition, rendererProps }) => {
    const { manifest } = definition;
    const [status, setStatus] = useState<StageStatus>('loading');
    // A lost WebGL context loads the scene once more; a second loss falls back.
    const [attempt, setAttempt] = useState(0);
    const boxRef = useRef<HTMLDivElement>(null);
    const propsRef = useRef(rendererProps);
    const surfaceRefs = useRef(new Map<string, HTMLDivElement>());
    const quads = useRef(new Map<string, ScreenQuad | null>());
    const options = useSceneSettingsStore(state => state.sceneOptions[manifest.id]);
    const plan = useMemo(
        () => planSceneLayers(manifest, { lyrics: options?.lyrics, screen: options?.screen }),
        [manifest, options?.lyrics, options?.screen],
    );
    const reducedMotion = useReducedMotionFor('uiMicroMotion');
    const reducedMotionRef = useRef(reducedMotion);
    const planRef = useRef(plan);
    useLayoutEffect(() => {
        propsRef.current = rendererProps;
        reducedMotionRef.current = reducedMotion;
        planRef.current = plan;
    });

    useEffect(() => {
        const box = boxRef.current;
        if (!box) return undefined;
        const id = manifest.id;
        let disposed = false;
        let runtime: SceneRuntime | null = null;
        let frameRequest = 0;
        let readyTimer = 0;
        let shown = false;
        const anchors: SceneAnchor[] = [];
        const signals = createSceneSignals(() => propsRef.current);
        const pointer = trackPointer();
        const written = new Map<string, string>();

        const stop = () => {
            disposed = true;
            bus.dispose();
            cancelAnimationFrame(frameRequest);
            window.clearTimeout(readyTimer);
            pointer.dispose();
            stopQueueEnd();
            resizeObserver.disconnect();
            box.removeEventListener('webglcontextlost', onContextLost, true);
            try {
                runtime?.dispose();
            } catch (error) {
                console.warn('[SceneHost] scene dispose threw', id, error);
            }
            runtime = null;
            box.replaceChildren();
        };
        const fail = (error: unknown) => {
            if (disposed) return;
            console.warn('[SceneHost] scene failed, showing the lyric style instead', id, error);
            stop();
            setStatus('failed');
        };
        // The scene's listeners and subscriptions: a throw in one fails the scene, and none is called after.
        const bus = createSceneEventBus(error => fail(error));
        const { emit } = bus;
        // Any canvas in the box: the event does not bubble, so it is caught on the way down.
        const onContextLost = () => {
            if (disposed) return;
            if (attempt > 0) {
                fail(new Error('WebGL context lost a second time'));
                return;
            }
            console.warn('[SceneHost] WebGL context lost, loading the scene again', id);
            stop();
            setStatus('loading');
            setAttempt(1);
        };
        box.addEventListener('webglcontextlost', onContextLost, true);
        const stopQueueEnd = onQueueEnd(() => emit('queueEnd', {}));
        const resizeObserver = new ResizeObserver(bus.guard(() => {
            runtime?.resize?.({ width: box.clientWidth, height: box.clientHeight, dpr: window.devicePixelRatio || 1 });
        }));
        resizeObserver.observe(box);

        const show = () => {
            if (disposed || shown) return;
            shown = true;
            window.clearTimeout(readyTimer);
            setStatus('running');
            console.info('[SceneHost] scene shown', id);
        };
        const preset = () => useSceneSettingsStore.getState().sceneOptions[id]?.quality ?? manifest.quality.default;
        const settings = () => ({
            ...Object.fromEntries((manifest.settings ?? []).map(field => [field.key, field.defaultValue])),
            ...valuesOf(id),
        });

        const ctx: SceneContext = {
            container: box,
            manifest,
            host: { kind: 'player', staticMode: Boolean(propsRef.current.staticMode), reducedMotion: reducedMotionRef.current },
            song: signals.song,
            lyrics: signals.lyrics,
            music: signals.music,
            player: signals.player,
            display: signals.display,
            input: { pointer: pointer.pointer },
            settings: {
                get: settings,
                onChange: (fn) => {
                    const changed = bus.guard(fn);
                    return bus.track(useSceneSettingsStore.subscribe((state, previous) => {
                        if (JSON.stringify(state.sceneOptions[id]?.values) !== JSON.stringify(previous.sceneOptions[id]?.values)) changed();
                    }));
                },
            },
            quality: { preset, get: key => manifest.quality.presets[preset()]?.[key] },
            anchors: {
                add: anchor => { anchors.push(anchor); },
                list: kind => anchors.filter(anchor => anchor.kind === kind) as never,
            },
            surfaces: {
                place: (surfaceId, quad) => { quads.current.set(surfaceId, quad); },
                uses: (surfaceId) => {
                    const surface = planRef.current.surfaces.find(entry => entry.id === surfaceId);
                    return { lyrics: Boolean(surface?.lyrics), background: Boolean(surface?.background) };
                },
            },
            seats: { chosen: () => useSceneSettingsStore.getState().sceneOptions[id]?.seat ?? null },
            sound: silentSceneSound,
            on: bus.on,
            ready: show,
            log: {
                info: (message, ...rest) => console.info(`[Scene ${id}] ${message}`, ...rest),
                warn: (message, ...rest) => console.warn(`[Scene ${id}] ${message}`, ...rest),
            },
        };

        // The borrowed boxes follow the corners the scene placed this frame; a surface not placed is hidden.
        const placeSurfaces = () => {
            const width = box.clientWidth;
            surfaceRefs.current.forEach((element, surfaceId) => {
                const quad = quads.current.get(surfaceId) ?? null;
                const aspect = manifest.surfaces?.find(surface => surface.id === surfaceId)?.aspect || 16 / 9;
                const height = Math.round(width / aspect);
                const style = quad ? `${width}x${height}|${quadToMatrix3d(width, height, quad)}` : 'hidden';
                if (written.get(surfaceId) === style) return;
                written.set(surfaceId, style);
                element.style.visibility = quad ? 'visible' : 'hidden';
                if (!quad) return;
                element.style.width = `${width}px`;
                element.style.height = `${height}px`;
                element.style.transform = style.slice(style.indexOf('|') + 1);
            });
        };

        let previous: SceneSignalSnapshot | null = null;
        let lastNow = 0;
        const tick = (nowMs: number) => {
            frameRequest = requestAnimationFrame(tick);
            const elapsed = lastNow ? (nowMs - lastNow) / 1000 : 0;
            lastNow = nowMs;
            const snapshot = signals.step();
            for (const type of diffSceneSignals(previous, snapshot, elapsed)) {
                if (type === 'songChange') emit(type, { song: signals.song.current() });
                else if (type === 'blendStart') {
                    const handoff = signals.song.handoff();
                    if (handoff) emit(type, { next: handoff.song });
                } else if (type === 'lineChange') emit(type, { index: snapshot.lineIndex, line: signals.lyrics.lines()[snapshot.lineIndex] ?? null });
                else if (type === 'phaseChange') emit(type, { phase: snapshot.phase, previous: previous!.phase });
                else if (type === 'seek') emit(type, { time: snapshot.time });
                else emit(type, {});
                if (disposed) return;
            }
            previous = snapshot;
            try {
                runtime?.frame({ dt: snapshot.paused ? 0 : Math.min(MAX_FRAME_DT, elapsed), now: nowMs / 1000 });
            } catch (error) {
                fail(error);
                return;
            }
            placeSurfaces();
        };

        void (async () => {
            try {
                const factory = await definition.load();
                if (disposed) return;
                const created = await factory(ctx);
                if (disposed) {
                    created.dispose();
                    return;
                }
                runtime = created;
                runtime.resize?.({ width: box.clientWidth, height: box.clientHeight, dpr: window.devicePixelRatio || 1 });
                console.info('[SceneHost] scene loaded', id, { attempt });
                readyTimer = window.setTimeout(show, READY_LIMIT_MS);
                frameRequest = requestAnimationFrame(tick);
            } catch (error) {
                fail(error);
            }
        })();
        return stop;
    }, [definition, manifest, attempt]);

    if (status === 'failed') return <VisualizerRenderer {...rendererProps} />;

    const hidden = status !== 'running';
    // A style or background chosen before the scene, which the scene does not take, is shown as the first it takes.
    const lyricMode = resolveSceneOffered(mode => sceneOffersLyricStyle(manifest, mode), rendererProps.mode, VISUALIZER_REGISTRY.map(entry => entry.mode));
    const backgroundMode = resolveSceneOffered(
        mode => sceneOffersBackground(manifest, mode),
        rendererProps.background?.mode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE,
        VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode),
    );
    const borrowed = (lyrics: boolean, background: boolean): RendererProps => ({
        ...rendererProps,
        mode: lyricMode,
        showText: lyrics ? rendererProps.showText : false,
        background: { ...rendererProps.background, mode: backgroundMode, transparent: background ? rendererProps.background?.transparent : true },
    });
    const surfaceBox = (surface: (typeof plan.surfaces)[number]) => (
        <div
            key={surface.id}
            ref={(element) => {
                if (element) surfaceRefs.current.set(surface.id, element);
                else surfaceRefs.current.delete(surface.id);
            }}
            className="absolute left-0 top-0 overflow-hidden"
            style={{ transformOrigin: '0 0', visibility: 'hidden' }}
            data-scene-surface={surface.id}
        >
            <VisualizerRenderer {...borrowed(surface.lyrics, surface.background)} />
        </div>
    );

    // Opaque borrowed content (a background) lies under the scene, which leaves a hole where it shows;
    // see-through content (a lyric style alone) lies over it.
    return (
        <>
            {hidden && <VisualizerRenderer {...rendererProps} />}
            <div className="absolute inset-0 overflow-hidden" style={hidden ? { visibility: 'hidden' } : undefined} data-scene={manifest.id}>
                {!hidden && plan.behindBackground && <VisualizerRenderer {...borrowed(false, true)} />}
                {!hidden && plan.surfaces.filter(surface => surface.background).map(surfaceBox)}
                <div ref={boxRef} className="absolute inset-0" />
                {!hidden && plan.surfaces.filter(surface => !surface.background).map(surfaceBox)}
                {!hidden && plan.overlayLyrics && <VisualizerRenderer {...borrowed(true, false)} />}
            </div>
        </>
    );
};

/**
 * Where the player page mounts its visualizer. With no scene chosen (or the chosen one not registered,
 * a mod's that has not loaded), exactly the VisualizerRenderer it always was.
 */
const SceneHost: React.FC<RendererProps> = (props) => {
    const reloadToken = useSceneSettingsStore(state => state.reloadToken);
    const definition = useChosenScene();
    if (!definition) return <VisualizerRenderer {...props} />;
    return <SceneStage key={`${definition.manifest.id}:${reloadToken}`} definition={definition} rendererProps={props} />;
};

export default SceneHost;
