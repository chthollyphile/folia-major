import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleOff, Clapperboard } from 'lucide-react';
import type { Theme } from '../../../types';
import { Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import StudioWindow, { StudioColumnBody } from '../../shared/StudioWindow';
import { FoliumParamFields, type FoliumParamFieldToken } from '../../../mods/params/FoliumParamFields';
import { mergeFoliumParamValues } from '../../../mods/params/params';
import type { SceneManifest, SceneQualityPreset } from '../definition';
import { useSceneViewpoints } from '../engine/sceneViewpoints';
import { useChosenScene, useSceneList } from '../registry';
import SeatMap from './SeatMap';
import { sceneLabel } from './SceneRow';
import SoundTracingGroup from './SoundTracingGroup';
import { useSceneSettingsStore } from './useSceneSettingsStore';

// src/components/scenes/settings/SceneWindow.tsx
// 设置「外观」页「场景」一行打开的窗口（和歌词动画样式的工作台同一个外壳 StudioWindow）：
// 左边是场景名单（第一个是「关」= 普通播放页），点一个就换成它；右边是选中场景自己的设置
// （画质、设置表、座位图，每个场景各存各的），下面是所有场景共用的「声线追踪」。

const QUALITIES: readonly SceneQualityPreset[] = ['low', 'medium', 'high'];

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

const CHOSEN: SettingsGroupDef = { id: 'sceneSettings', titleKey: 'ui.sceneSettings' };

/** The chosen scene's name, or 关 for the plain player page. */
export const ChosenSceneName: React.FC = () => {
    const { t, i18n } = useTranslation();
    const manifest = useChosenScene()?.manifest;
    return <>{manifest ? sceneLabel(manifest, i18n.language) : t('ui.sceneNone')}</>;
};

const SceneOwnSettings: React.FC<{ manifest: SceneManifest }> = ({ manifest }) => {
    const { t } = useTranslation();
    const options = useSceneSettingsStore(state => state.sceneOptions[manifest.id]);
    const setSceneOptions = useSceneSettingsStore(state => state.setSceneOptions);
    const seats = useSceneViewpoints(manifest.id);
    const schema = manifest.settings ?? [];
    const values = useMemo(() => mergeFoliumParamValues(schema, options?.values), [schema, options?.values]);

    return (
        <Group def={CHOSEN}>
            <Row label={t('ui.sceneQuality')}>
                <Segmented
                    value={options?.quality ?? manifest.quality.default}
                    options={QUALITIES.map(value => ({ value, label: t(`ui.sceneQuality_${value}`) }))}
                    onChange={quality => setSceneOptions(manifest.id, { quality })}
                />
            </Row>
            {schema.length > 0 && (
                <Row
                    below={(
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
                />
            )}
            {manifest.viewpoints === 'anchors' && seats.length > 0 && (
                <Row
                    label={t('ui.sceneSeat')}
                    below={<SeatMap seats={seats} chosen={options?.viewpoint ?? null} onPick={viewpoint => setSceneOptions(manifest.id, { viewpoint })} />}
                />
            )}
        </Group>
    );
};

interface SceneWindowProps {
    isDaylight: boolean;
    theme?: Theme;
    onClose: () => void;
}

const SceneWindow: React.FC<SceneWindowProps> = ({ isDaylight, theme, onClose }) => {
    const { t, i18n } = useTranslation();
    const scenes = useSceneList();
    const chosen = useChosenScene();
    const setSceneId = useSceneSettingsStore(state => state.setSceneId);
    const choices = [
        { id: null, label: t('ui.sceneNone'), icon: <CircleOff size={18} /> },
        ...scenes.map(scene => ({ id: scene.manifest.id, label: sceneLabel(scene.manifest, i18n.language), icon: <Clapperboard size={18} /> })),
    ];
    const chosenId = chosen?.manifest.id ?? null;

    return (
        <StudioWindow
            title={t('ui.scene')}
            onBack={onClose}
            backLabel={t('ui.back')}
            isDaylight={isDaylight}
            theme={theme}
            stage={(
                <div className="flex flex-col gap-2 p-4 sm:p-6" role="group" aria-label={t('ui.scene')}>
                    {choices.map(choice => (
                        <button
                            key={choice.id ?? 'none'}
                            type="button"
                            aria-pressed={choice.id === chosenId}
                            onClick={() => setSceneId(choice.id)}
                            className={`st-t-fast flex min-h-14 items-center gap-3 rounded-xl px-4 text-left text-sm transition-colors ${
                                choice.id === chosenId
                                    ? 'bg-[var(--st-fill2)] text-[color:var(--st-t1)] shadow-[0_0_0_1.5px_var(--st-accent)]'
                                    : 'bg-[var(--st-fill)] text-[color:var(--st-t2)] hover:text-[color:var(--st-t1)]'
                            }`}
                        >
                            {choice.icon}
                            <span className="min-w-0 truncate">{choice.label}</span>
                        </button>
                    ))}
                </div>
            )}
        >
            <StudioColumnBody>
                {chosen && <SceneOwnSettings manifest={chosen.manifest} />}
                <SoundTracingGroup />
            </StudioColumnBody>
        </StudioWindow>
    );
};

export default SceneWindow;
