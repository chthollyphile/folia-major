import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, Segmented, Toggle } from '../../modal/settings/kit';
import { FoliumParamFields, type FoliumParamFieldToken } from '../../../mods/params/FoliumParamFields';
import { mergeFoliumParamValues } from '../../../mods/params/params';
import type { SceneManifest, SceneQualityPreset } from '../definition';
import { useSceneSeats } from '../engine/sceneSeats';
import SeatMap from './SeatMap';
import { useSceneSettingsStore, type SceneRoomOutput } from './useSceneSettingsStore';

// src/components/scenes/settings/SceneSettingsPanel.tsx
// The layer the scene row's 「场景设置」 chip opens: the quality preset, for a scene that plays the music through
// its speakers the room sound switch and headphones or speakers (shared by all scenes), the scene's own settings
// table (drawn by the mods' shared form) and, for a scene with seat anchors, the seat map. Each change applies at once.

const QUALITIES: readonly SceneQualityPreset[] = ['low', 'medium', 'high'];
const OUTPUTS: readonly SceneRoomOutput[] = ['headphones', 'speakers'];

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
    const seats = useSceneSeats(manifest.id);
    const schema = manifest.settings ?? [];
    const values = useMemo(() => mergeFoliumParamValues(schema, options?.values), [schema, options?.values]);
    const qualities = QUALITIES.map(value => ({ value, label: t(`ui.sceneQuality_${value}`) }));
    const roomSound = useSceneSettingsStore(state => state.roomSound);
    const roomOutput = useSceneSettingsStore(state => state.roomOutput);
    const setRoomSound = useSceneSettingsStore(state => state.setRoomSound);
    const setRoomOutput = useSceneSettingsStore(state => state.setRoomOutput);
    const outputs = OUTPUTS.map(value => ({ value, label: t(`ui.sceneRoomOutput_${value}`) }));
    const hasRoom = manifest.sound?.music === 'speakers';

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
            {hasRoom && (
                <div className="flex items-center justify-between gap-3">
                    <span id="scene-room-sound" className="text-xs text-[color:var(--st-t2)]">{t('ui.sceneRoomSound')}</span>
                    <Toggle checked={roomSound} onChange={setRoomSound} labelledBy="scene-room-sound" />
                </div>
            )}
            {hasRoom && roomSound && (
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[color:var(--st-t2)]">{t('ui.sceneRoomOutput')}</span>
                    <Segmented value={roomOutput} options={outputs} onChange={setRoomOutput} />
                </div>
            )}
            {schema.length > 0 && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    <FoliumParamFields
                        params={schema}
                        values={values}
                        token={TOKEN}
                        booleanLabels={{ on: t('options.modVisualizerSettingsOn'), off: t('options.modVisualizerSettingsOff') }}
                        onChange={(param, value) => setSceneOptions(manifest.id, { values: { ...options?.values, [param.key]: value as string | number | boolean } })}
                    />
                </div>
            )}
            {manifest.seats === 'anchors' && seats.length > 0 && (
                <SeatMap seats={seats} chosen={options?.seat ?? null} onPick={seat => setSceneOptions(manifest.id, { seat })} />
            )}
        </Popover>
    );
};

export default SceneSettingsPanel;
