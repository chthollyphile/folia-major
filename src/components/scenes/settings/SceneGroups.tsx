import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Row, Segmented, Select, option, type SettingsGroupDef } from '../../modal/settings/kit';
import { FoliumParamFields, type FoliumParamFieldToken } from '../../../mods/params/FoliumParamFields';
import { mergeFoliumParamValues, resolveFoliumLabel } from '../../../mods/params/params';
import type { SceneManifest, SceneQualityPreset } from '../definition';
import { useSceneViewpoints } from '../engine/sceneViewpoints';
import { getScene, useChosenScene, useSceneList } from '../registry';
import SeatMap from './SeatMap';
import { useSceneSettingsStore } from './useSceneSettingsStore';

// src/components/scenes/settings/SceneGroups.tsx
// 设置「场景」页的前两组：选哪个场景（关 = 普通播放页），以及选中场景的画质、它自己的设置表
// （模组共用的表单）和座位图（场景在跑、有座位锚点时才有）。每项改了马上生效。

const NO_SCENE = 'none';
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

const CHOICE: SettingsGroupDef = { id: 'scene', titleKey: 'ui.scene' };
const CHOSEN: SettingsGroupDef = {
    id: 'sceneSettings',
    titleKey: 'ui.sceneSettings',
    available: () => getScene(useSceneSettingsStore.getState().sceneId) !== null,
};

const O = {
    choice: option(CHOICE, 'sceneChoice', 'ui.scene'),
    quality: option(CHOSEN, 'sceneQuality', 'ui.sceneQuality'),
    seat: option(CHOSEN, 'sceneSeat', 'ui.sceneSeat'),
};

export const SCENE_GROUP_OPTIONS = Object.values(O);

const sceneLabel = (manifest: SceneManifest, language: string) => resolveFoliumLabel(manifest.name, language, manifest.id);

const ChosenSceneGroup: React.FC<{ manifest: SceneManifest }> = ({ manifest }) => {
    const { t } = useTranslation();
    const options = useSceneSettingsStore(state => state.sceneOptions[manifest.id]);
    const setSceneOptions = useSceneSettingsStore(state => state.setSceneOptions);
    const seats = useSceneViewpoints(manifest.id);
    const schema = manifest.settings ?? [];
    const values = useMemo(() => mergeFoliumParamValues(schema, options?.values), [schema, options?.values]);

    return (
        <Group def={CHOSEN}>
            <Row option={O.quality}>
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
                    option={O.seat}
                    below={<SeatMap seats={seats} chosen={options?.viewpoint ?? null} onPick={viewpoint => setSceneOptions(manifest.id, { viewpoint })} />}
                />
            )}
        </Group>
    );
};

const SceneGroups: React.FC = () => {
    const { t, i18n } = useTranslation();
    const scenes = useSceneList();
    const chosen = useChosenScene();
    const setSceneId = useSceneSettingsStore(state => state.setSceneId);
    const choices = [
        { value: NO_SCENE, label: t('ui.sceneNone') },
        ...scenes.map(scene => ({ value: scene.manifest.id, label: sceneLabel(scene.manifest, i18n.language) })),
    ];

    return (
        <>
            <Group def={CHOICE} bare>
                <Row option={O.choice}>
                    <Select
                        value={chosen?.manifest.id ?? NO_SCENE}
                        options={choices}
                        onChange={next => setSceneId(next === NO_SCENE ? null : next)}
                    />
                </Row>
            </Group>
            {chosen && <ChosenSceneGroup manifest={chosen.manifest} />}
        </>
    );
};

export default SceneGroups;
