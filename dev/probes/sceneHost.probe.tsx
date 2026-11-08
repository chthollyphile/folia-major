import React, { useEffect, useMemo, useState } from 'react';
import { motionValue } from 'framer-motion';
import SceneHost from '../../src/components/scenes/engine/SceneHost';
import { defineScene, type SceneManifest } from '../../src/components/scenes/definition';
import { registerScene } from '../../src/components/scenes/registry';
import { useSceneViewpoints } from '../../src/components/scenes/engine/sceneViewpoints';
import SeatMap from '../../src/components/scenes/settings/SeatMap';
import { useSceneSettingsStore } from '../../src/components/scenes/settings/useSceneSettingsStore';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { Line } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/sceneHost.probe.tsx

/**
 * 场景宿主的探针：登记两个模组场景，一个 2D 画布场景（按住拖动荧幕表面跟着动，借来的歌词样式贴在上面，
 * 画布上写着歌词阶段和收到的事件；能弄丢一次 WebGL），一个加载就抛错的场景。
 * 看三件事：没选场景时就是原来的歌词样式；选了方块场景时样式贴到斜着的荧幕上；选了坏场景时回到歌词样式（控制台有 [SceneHost] scene failed）。
 * 影厅（内建 'cinema'）：荧幕上是歌词样式和背景；按住拖动转头，点歌词照常有效；右上是座位图（点一下换座位）。
 */

const QUALITY: SceneManifest['quality'] = { default: 'low', presets: { low: {}, medium: {}, high: {} } };

const boxes = defineScene({
    manifest: {
        format: 1,
        engine: '^1.0',
        id: 'mod:probe:boxes',
        version: '1.0.0',
        name: { en: 'Probe boxes', 'zh-CN': '探针方块' },
        surfaces: [{ id: 'screen', aspect: 16 / 9 }],
        lyrics: { style: { surface: 'screen' }, exclude: ['still'] },
        background: { host: 'none' },
        quality: QUALITY,
    },
    load: async () => (ctx) => {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
        ctx.container.appendChild(canvas);
        const g = canvas.getContext('2d')!;
        // A WebGL context only so the probe can lose it (the host loads the scene again once, then falls back).
        const gl = document.createElement('canvas').getContext('webgl');
        if (gl) ctx.container.appendChild(gl.canvas as HTMLCanvasElement);
        (window as unknown as { __sceneProbeLoseContext?: () => void }).__sceneProbeLoseContext = () => gl?.getExtension('WEBGL_lose_context')?.loseContext();
        const events: string[] = [];
        (['songChange', 'blendStart', 'lineChange', 'phaseChange', 'play', 'pause', 'seek', 'queueEnd'] as const).forEach(type => {
            ctx.on(type, () => { events.unshift(type); events.length = Math.min(events.length, 8); });
        });
        let width = 1;
        let height = 1;
        let t = 0;
        // A drag moves the screen surface (ctx.input.look), kept within a small reach.
        const shift = { x: 0, y: 0 };
        let first = true;
        return {
            frame: ({ dt }) => {
                t += dt;
                const turned = ctx.input.look();
                shift.x = Math.max(-1, Math.min(1, shift.x - turned.yaw));
                shift.y = Math.max(-1, Math.min(1, shift.y + turned.pitch));
                g.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
                g.fillStyle = '#101418';
                g.fillRect(0, 0, width, height);
                const cx = width / 2 + shift.x * 40;
                const cy = height / 2 - shift.y * 30;
                const w = width * 0.55;
                const h = w / (16 / 9);
                const skew = Math.sin(t) * 30;
                const quad = [
                    { x: cx - w / 2, y: cy - h / 2 + skew },
                    { x: cx + w / 2, y: cy - h / 2 - skew },
                    { x: cx + w / 2, y: cy + h / 2 + skew },
                    { x: cx - w / 2, y: cy + h / 2 - skew },
                ] as const;
                g.strokeStyle = '#e8b04b';
                g.lineWidth = 6;
                g.beginPath();
                quad.forEach((point, index) => (index === 0 ? g.moveTo(point.x, point.y) : g.lineTo(point.x, point.y)));
                g.closePath();
                g.stroke();
                g.fillStyle = '#ffffff';
                g.font = '14px monospace';
                g.fillText(`phase ${ctx.lyrics.phase()}  line ${ctx.lyrics.lineIndex()}  next ${ctx.lyrics.nextLineIn().toFixed(1)}s  paused ${ctx.player.paused()}`, 16, 24);
                g.fillText(`events ${events.join(' ')}`, 16, 44);
                ctx.surfaces.place('screen', quad);
                if (first) {
                    first = false;
                    ctx.ready();
                }
            },
            resize: (size) => {
                width = size.width;
                height = size.height;
                canvas.width = Math.round(size.width * size.dpr);
                canvas.height = Math.round(size.height * size.dpr);
            },
            dispose: () => {
                canvas.remove();
            },
        };
    },
});

const broken = defineScene({
    manifest: { ...boxes.manifest, id: 'mod:probe:broken', name: { en: 'Probe broken', 'zh-CN': '探针坏场景' } },
    load: async () => {
        throw new Error('probe: this scene fails to load on purpose');
    },
});

const LINES: Line[] = [3, 7, 11, 25, 29].map((start, index) => ({
    words: [],
    startTime: start,
    endTime: start + 3,
    fullText: `Probe line ${index + 1} 第${index + 1}句`,
}));
const LOOP_SEC = 36;

/** A made-up cover for the hall's reel: a gradient with a ring. */
const probeCover = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const g = canvas.getContext('2d')!;
    const gradient = g.createLinearGradient(0, 0, 512, 512);
    gradient.addColorStop(0, '#3b82f6');
    gradient.addColorStop(1, '#f43f5e');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = '#fde68a';
    g.lineWidth = 24;
    g.beginPath();
    g.arc(256, 256, 140, 0, Math.PI * 2);
    g.stroke();
    return canvas.toDataURL('image/png');
};

/** Stand-ins for the settings kit's colours, which the probe page does not have. */
const KIT_COLORS = { '--st-accent': '#e8b04b', '--st-fill': 'rgba(255,255,255,0.12)', '--st-fill2': 'rgba(255,255,255,0.3)', '--st-t3': 'rgba(255,255,255,0.5)' } as React.CSSProperties;

const SceneHostProbe: React.FC = () => {
    const sceneId = useSceneSettingsStore(state => state.sceneId);
    const setSceneOptions = useSceneSettingsStore(state => state.setSceneOptions);
    const hallOptions = useSceneSettingsStore(state => state.sceneOptions.cinema);
    const seats = useSceneViewpoints('cinema');
    const coverUrl = useMemo(probeCover, []);
    const setSceneId = useSceneSettingsStore(state => state.setSceneId);
    const [paused, setPaused] = useState(false);
    const signals = useMemo(() => ({
        currentTime: motionValue(0),
        audioPower: motionValue(0.3),
        audioBands: { bass: motionValue(0.4), lowMid: motionValue(0.3), mid: motionValue(0.3), vocal: motionValue(0.2), treble: motionValue(0.1) },
    }), []);
    const [lineIndex, setLineIndex] = useState(-1);

    useEffect(() => {
        registerScene(boxes);
        registerScene(broken);
    }, []);

    useEffect(() => {
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            const dt = (now - last) / 1000;
            last = now;
            if (paused) return;
            const time = (signals.currentTime.get() + dt) % LOOP_SEC;
            signals.currentTime.set(time);
            const index = LINES.findIndex(line => time >= line.startTime && time < line.endTime);
            setLineIndex(previous => (previous === index ? previous : index));
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [paused, signals]);

    const choose = (id: string | null) => () => setSceneId(id);
    const button = 'rounded border border-white/20 px-3 py-1 text-sm text-white hover:bg-white/10';
    return (
        <div className="fixed inset-0 bg-black">
            <div className="absolute inset-0">
                <SceneHost
                    mode="classic"
                    currentTime={signals.currentTime}
                    currentLineIndex={lineIndex}
                    lines={LINES}
                    theme={DEFAULT_THEME}
                    audioPower={signals.audioPower}
                    audioBands={signals.audioBands}
                    seed="probe-song"
                    coverUrl={coverUrl}
                    songTitle="Probe song"
                    paused={paused}
                    duration={LOOP_SEC}
                />
            </div>
            <div className="absolute bottom-4 left-4 z-50 flex gap-2" data-probe-scene={sceneId ?? 'none'}>
                <button type="button" className={button} onClick={choose(null)}>No scene</button>
                <button type="button" className={button} onClick={choose('mod:probe:boxes')}>Boxes scene</button>
                <button type="button" className={button} onClick={choose('mod:probe:broken')}>Broken scene</button>
                <button type="button" className={button} onClick={choose('cinema')}>Cinema</button>
                <button type="button" className={button} onClick={() => setPaused(value => !value)}>{paused ? 'Play' : 'Pause'}</button>
                <button type="button" className={button} onClick={() => (window as unknown as { __sceneProbeLoseContext?: () => void }).__sceneProbeLoseContext?.()}>Lose WebGL</button>
            </div>
            {sceneId === 'cinema' && seats.length > 0 && (
                <div className="absolute right-4 top-4 z-50 w-80 rounded-xl bg-black/70 p-3" style={KIT_COLORS} data-probe-seatmap>
                    <SeatMap seats={seats} chosen={hallOptions?.viewpoint ?? null} onPick={viewpoint => setSceneOptions('cinema', { viewpoint })} />
                </div>
            )}
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'sceneHost',
    title: 'Scene host',
    description: '场景宿主挂一个 2D 场景、把歌词样式贴到荧幕表面上，场景加载抛错或 WebGL 丢两次时回到歌词样式。',
    Component: SceneHostProbe,
};

export default probe;
