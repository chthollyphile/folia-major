import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, Segmented, Toggle } from '../../modal/settings/kit';
import { FoliumParamFields, type FoliumParamFieldToken } from '../../../mods/params/FoliumParamFields';
import { mergeFoliumParamValues } from '../../../mods/params/params';
import type { SceneManifest, SceneQualityPreset } from '../definition';
import { useSceneViewpoints } from '../engine/sceneViewpoints';
import SeatMap from './SeatMap';
import { useSceneSettingsStore } from './useSceneSettingsStore';
import { useSoundTracingStore, type SoundTracingOutput } from './useSoundTracingStore';

// src/components/scenes/settings/SceneSettingsPanel.tsx
// The layer the scene row's 「场景设置」 chip opens: the quality preset, for a scene that plays the music through
// its speakers the sound tracing switch and headphones or speakers (shared by all scenes), the scene's own settings
// table (drawn by the mods' shared form) and, for a scene with seat anchors, the seat map. Each change applies at once.

const QUALITIES: readonly SceneQualityPreset[] = ['low', 'medium', 'high'];
const OUTPUTS: readonly SoundTracingOutput[] = ['headphones', 'speakers'];

const TOKEN: FoliumParamFieldToken = {
    label: 'text-xs text-[color:var(--st-t2)] truncate',
    readonlyLabel: 'text-xs text-[color:var(--st-t3)] font-mono',
    input: 'w-full rounded-lg px-2.5 py-1.5 text-xs outline-none min-w-0 bg-[var(--st-fill)] text-[color:var(--st-t1)]',
    groupLabel: 'text-xs font-medium text-[color:var(--st-t2)] pt-2',
    toggleOn: 'bg-[var(--st-fill2)] text-[color:var(--st-t1)]',
    toggleOff: 'bg-[var(--st-fill)] text-[color:var(--st-t2)]',
    dotOn: 'bg-[var(--st-accent)]',
    dotOff: 'bg-[var(--st-t3)]',
};

interface SceneSettingsPanelProps {
    manifest: SceneManifest;
    anchorRef: React.RefObject<HTMLElement | null>;
    open: boolean;
    onClose: () => void;
}

const SceneSettingsPanel: React.FC<SceneSettingsPanelProps> = ({ manifest, anchorRef, open, onClose }) => {
    const { t } = useTranslation();
    const options = useSceneSettingsStore(state => state.sceneOptions[manifest.id]);
    const setSceneOptions = useSceneSettingsStore(state => state.setSceneOptions);
    const seats = useSceneViewpoints(manifest.id);
    const schema = useMemo(() => manifest.settings ?? [], [manifest.settings]);
    const values = useMemo(() => mergeFoliumParamValues(schema, options?.values), [schema, options?.values]);
    const qualities = QUALITIES.map(value => ({ value, label: t(`ui.sceneQuality_${value}`) }));
    const tracing = useSoundTracingStore(state => state.enabled);
    const output = useSoundTracingStore(state => state.output);
    const setTracing = useSoundTracingStore(state => state.setEnabled);
    const setOutput = useSoundTracingStore(state => state.setOutput);
    const outputs = OUTPUTS.map(value => ({ value, label: t(`ui.soundTracingOutput_${value}`) }));
    // Sound tracing runs in the desktop app's acoustics process; the web build has none.
    const tracesSound = manifest.sound?.music === 'speakers' && typeof window !== 'undefined' && Boolean(window.electron);

    return (
        <Popover anchorRef={anchorRef} open={open} onClose={onClose} fill aria-label={t('ui.sceneSettings')} className="flex flex-col gap-3 rounded-[14px] px-4 pb-3 pt-2">
            <span className="text-[13px] font-semibold leading-7 text-[color:var(--st-t2)]">{t('ui.sceneSettings')}</span>
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-[color:var(--st-t2)]">{t('ui.sceneQuality')}</span>
                <Segmented
                    value={options?.quality ?? manifest.quality.default}
                    options={qualities}
                    onChange={quality => setSceneOptions(manifest.id, { quality })}
                />
            </div>
            {tracesSound && (
                <div className="flex items-center justify-between gap-3">
                    <span id="scene-sound-tracing" className="text-xs text-[color:var(--st-t2)]">{t('ui.soundTracing')}</span>
                    <Toggle checked={tracing} onChange={setTracing} labelledBy="scene-sound-tracing" />
                </div>
            )}
            {tracesSound && tracing && (
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[color:var(--st-t2)]">{t('ui.soundTracingOutput')}</span>
                    <Segmented value={output} options={outputs} onChange={setOutput} />
                </div>
            )}
            {schema.length > 0 && (
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <FoliumParamFields
                        params={schema}
                        values={values}
                        token={TOKEN}
                        booleanLabels={{ on: t('options.modVisualizerSettingsOn'), off: t('options.modVisualizerSettingsOff') }}
                        onChange={(param, value) => setSceneOptions(manifest.id, { values: { ...options?.values, [param.key]: value as string | number | boolean } })}
                    />
                </div>
            )}
            {manifest.viewpoints === 'anchors' && seats.length > 0 && (
                <SeatMap seats={seats} chosen={options?.viewpoint ?? null} onPick={viewpoint => setSceneOptions(manifest.id, { viewpoint })} />
            )}
        </Popover>
    );
};

export default SceneSettingsPanel;
