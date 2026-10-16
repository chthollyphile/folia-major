import React, { useLayoutEffect, useState } from 'react';
import VisualStyleActions from '../../src/components/shared/VisualStyleActions';
import VisPlayground from '../../src/components/visualizer/VisPlayground';
import { useRandomVisualizerMode } from '../../src/hooks/useRandomVisualizerMode';
import { useVisualizerSettingsStore } from '../../src/stores/useVisualizerSettingsStore';
import { useTypographySettingsStore } from '../../src/stores/useTypographySettingsStore';
import { useThemeSettingsStore } from '../../src/stores/useThemeSettingsStore';
import { useVisualizerAssetStore } from '../../src/stores/useVisualizerAssetStore';
import { usePlaybackStore } from '../../src/stores/usePlaybackStore';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import { PlayerState, type SongResult } from '../../src/types';
import type { ProbeDefinition } from './definition';

// dev/probes/manualRandomStyle.probe.tsx
// Production controls and the existing per-song hook verify persistence through real song changes.
const songs: SongResult[] = ['a', 'b'].map(id => ({
    id, name: `Song ${id}`, artists: [{ id: 1, name: 'Probe' }], album: { id: 1, name: 'Probe' },
    durationMs: 180000, sourceRef: { kind: 'local', mediaId: id },
}));
const rendererTuningKeys = [
    'classicTuning', 'cadenzaTuning', 'partitaTuning', 'fumeTuning', 'claddaghTuning',
    'cappellaTuning', 'tiltTuning', 'dioramaTuning', 'monetTuning', 'pendoloTuning',
    'sonnetTuning', 'temperaTuning', 'lumiereTuning',
] as const;

const readAppearance = () => {
    const { randomizeAllEnabled: _scope, randomVisualizerModePerSong: _automatic, ...visual } = useVisualizerSettingsStore.getState();
    const typography = useTypographySettingsStore.getState();
    const protectedVisual: Record<string, unknown> = { ...visual };
    delete protectedVisual.visualizerMode;
    for (const key of rendererTuningKeys) delete protectedVisual[key];
    const useCoverColorBg = useThemeSettingsStore.getState().useCoverColorBg;
    return {
        appearance: JSON.stringify({ visual, typography, useCoverColorBg }),
        protected: JSON.stringify({ visual: protectedVisual, typography, useCoverColorBg }),
        assets: JSON.stringify(useVisualizerAssetStore.getState()),
        tunings: JSON.stringify(Object.fromEntries(rendererTuningKeys.map(key => [key, visual[key]]))),
    };
};

const ManualRandomStyleProbe: React.FC = () => {
    const visual = useVisualizerSettingsStore();
    const typography = useTypographySettingsStore();
    const useCoverColorBg = useThemeSettingsStore(state => state.useCoverColorBg);
    const song = usePlaybackStore(state => state.currentSong);
    const playerState = usePlaybackStore(state => state.playerState);
    const [previewOpen, setPreviewOpen] = useState(false);
    useLayoutEffect(() => {
        usePlaybackStore.setState({ currentSong: songs[0], playerState: PlayerState.PLAYING });
    }, []);
    useRandomVisualizerMode({
        currentSong: song, enabled: visual.randomVisualizerModePerSong,
        visualizerMode: visual.visualizerMode, setVisualizerMode: visual.handleSetVisualizerMode,
    });
    return (
        <div className="min-h-screen space-y-4 bg-zinc-950 p-6 text-zinc-100">
            <div className="max-w-xl rounded-xl border border-white/10 p-4">
                <VisualStyleActions theme={DEFAULT_THEME} isDaylight={false} />
            </div>
            <div className="flex flex-wrap gap-4">
                <button onClick={() => visual.handleToggleRandomVisualizerModePerSong(true)}>Enable legacy song randomization</button>
                <button onClick={() => usePlaybackStore.setState({ currentSong: song?.id === 'a' ? songs[1] : songs[0] })}>Next song</button>
                <button onClick={() => usePlaybackStore.getState().setPlayerState(PlayerState.PAUSED)}>Pause playback</button>
                <button onClick={() => setPreviewOpen(true)}>Open preview</button>
                <label>Classic word spacing
                    <input aria-label="Classic word spacing" type="number" step="0.01" value={visual.classicTuning.wordSpacing ?? 0.7}
                        onChange={event => visual.handleSetClassicTuning({ wordSpacing: Number(event.target.value) })} />
                </label>
            </div>
            {Object.entries({
                mode: visual.visualizerMode, legacy: String(visual.randomVisualizerModePerSong),
                savedLegacy: localStorage.getItem('random_visualizer_mode_per_song') ?? '-',
                song: String(song?.id ?? '-'), playerState,
                ...readAppearance(),
            }).map(([key, value]) => <output key={key} data-manual-random={key} className="block" hidden={!['mode', 'song', 'legacy'].includes(key)}>{value}</output>)}
            {previewOpen && <VisPlayground
                theme={DEFAULT_THEME} isDaylight={false} staticMode
                visualizerMode={visual.visualizerMode} visualizerOpacity={visual.visualizerOpacity}
                fontStyle={typography.lyricsFontStyle} fontScale={typography.lyricsFontScale} fontWeight={typography.lyricsFontWeight}
                customFontFamily={typography.lyricsCustomFont?.family ?? null} customFontLabel={typography.lyricsCustomFont?.label ?? null}
                onFontStyleChange={typography.handleSetLyricsFontStyle} onFontScaleChange={typography.handleSetLyricsFontScale}
                onFontWeightChange={typography.handleSetLyricsFontWeight} onCustomFontChange={typography.handleSetLyricsCustomFont}
                onVisualizerModeChange={visual.handleSetVisualizerMode} onVisualizerOpacityChange={visual.handleSetVisualizerOpacity}
                classicTuning={visual.classicTuning} onClassicTuningChange={visual.handleSetClassicTuning}
                tiltTuning={visual.tiltTuning} onTiltTuningChange={visual.handleSetTiltTuning}
                backgroundConfig={{
                    mode: visual.visualizerBackgroundMode,
                    common: { opacity: visual.backgroundOpacity, useCoverColorBg, disableVignette: visual.disableVisualizerVignette, disableGeometricBackground: visual.disableVisualizerGeometricBackground },
                    monet: { tuning: visual.monetBackgroundTuning }, nomand: { tuning: visual.nomandBackgroundTuning },
                    latent: { tuning: visual.latentBackgroundTuning }, sora: { tuning: visual.soraBackgroundTuning },
                }} onClose={() => setPreviewOpen(false)}
            />}
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'manualRandomStyle', title: '手动随机样式',
    description: '真实随机控件、歌词预览和旧切歌 hook，验证范围、固定配置及重载恢复。',
    Component: ManualRandomStyleProbe,
};
export default definition;
