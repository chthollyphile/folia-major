import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleOff, Clapperboard } from 'lucide-react';
import type { Theme } from '../../../types';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { Button, Group, PictureGrid, Row, Segmented, Tabs, type SettingsGroupDef } from '../../modal/settings/kit';
import StudioWindow, { StudioColumnBody } from '../../shared/StudioWindow';
import { SHELF_COLUMNS } from '../../visualizer/window/VisPlayground';
import { FoliumParamFields, type FoliumParamFieldToken } from '../../../mods/params/FoliumParamFields';
import { mergeFoliumParamValues } from '../../../mods/params/params';
import type { SceneManifest, SceneQualityPreset } from '../definition';
import { useSceneViewpoints } from '../engine/sceneViewpoints';
import { getScene, useChosenScene, useSceneList } from '../registry';
import SeatMap from './SeatMap';
import { sceneLabel } from './SceneRow';
import SoundTracingGroup from './SoundTracingGroup';
import { useSceneSettingsStore } from './useSceneSettingsStore';

// src/components/scenes/settings/SceneWindow.tsx
// 设置「外观」页「场景」一行打开的窗口，样子和用法照歌词样式的工作台（VisPlayground）：同一个外壳
// StudioWindow，左上是大预览，下面是「场景 N」和一格一格的场景卡（第一格「关」= 普通播放页），点一格就换成它；
// 右边是两个标签：「场景设置」（选中场景自己的画质、设置表、座位图，每个场景各存各的，「默认」清掉这个场景的设置）
// 和「声线追踪」（所有场景共用）。
// 预览只画场景的图或名字：场景宿主只认播放页（host 'player'，还接着播放链上的声线追踪），
// 窗口里再跑一个场景要给引擎加 'preview' 宿主，这里不做。

const NO_SCENE = 'none';
const QUALITIES: readonly SceneQualityPreset[] = ['low', 'medium', 'high'];
type Tab = 'scene' | 'sound';
const TABS: readonly Tab[] = ['scene', 'sound'];
const TAB_LABEL_KEYS: Record<Tab, string> = { scene: 'ui.sceneSettings', sound: 'ui.soundTracing' };

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

/** A scene's picture, or its glyph where it has none (as the shelf draws a style without one). */
const ScenePicture: React.FC<{ manifest: SceneManifest | undefined; size: number }> = ({ manifest, size }) => (
    manifest?.preview
        ? <img src={manifest.preview} alt="" draggable={false} className="h-full w-full object-cover" />
        : (
            <span className="grid h-full w-full place-items-center text-[color:var(--st-accent)]">
                {manifest ? <Clapperboard size={size} /> : <CircleOff size={size} />}
            </span>
        )
);

// One function for every tile, so the grid does not draw them all again on each render.
const drawSceneChoice = (id: string) => <ScenePicture manifest={getScene(id === NO_SCENE ? null : id)?.manifest} size={28} />;

const SceneOwnSettings: React.FC<{ manifest: SceneManifest }> = ({ manifest }) => {
    const { t } = useTranslation();
    const options = useSceneSettingsStore(state => state.sceneOptions[manifest.id]);
    const setSceneOptions = useSceneSettingsStore(state => state.setSceneOptions);
    const seats = useSceneViewpoints(manifest.id);
    const schema = manifest.settings ?? [];
    const values = useMemo(() => mergeFoliumParamValues(schema, options?.values), [schema, options?.values]);

    return (
        <Group def={CHOSEN} bare>
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
    const manifest = chosen?.manifest;
    const setSceneId = useSceneSettingsStore(state => state.setSceneId);
    const setSceneOptions = useSceneSettingsStore(state => state.setSceneOptions);
    const hasOwnOptions = useSceneSettingsStore(state => Object.keys((manifest && state.sceneOptions[manifest.id]) ?? {}).length > 0);
    const [tab, setTab] = useState<Tab>('scene');
    const isWideWindow = useMediaQuery('(min-width: 1024px)');
    const choices = [
        { value: NO_SCENE, label: t('ui.sceneNone') },
        ...scenes.map(scene => ({ value: scene.manifest.id, label: sceneLabel(scene.manifest, i18n.language) })),
    ];
    // Undefined fields are dropped by the store's sanitizer, so this clears the scene's own options.
    const resetScene = tab === 'scene' && manifest && hasOwnOptions
        ? () => setSceneOptions(manifest.id, { quality: undefined, viewpoint: undefined, values: undefined })
        : undefined;

    const stage = (
        <>
            <div className="relative min-h-[160px] flex-1 overflow-hidden rounded-xl bg-[var(--st-pv)] shadow-[0_0_0_1px_var(--st-line)]">
                {manifest?.preview
                    ? <ScenePicture manifest={manifest} size={56} />
                    : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[color:var(--st-t2)]">
                            {manifest ? <Clapperboard size={48} /> : <CircleOff size={48} />}
                            <span className="text-sm">{manifest ? sceneLabel(manifest, i18n.language) : t('ui.sceneNone')}</span>
                        </div>
                    )}
            </div>
            <div className="flex shrink-0 flex-col">
                <h3 className="mb-2 flex min-h-6 items-center px-1 text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">
                    {t('ui.scene')}
                    <span className="ml-1.5 font-normal text-[color:var(--st-t3)]">{choices.length}</span>
                </h3>
                <PictureGrid
                    value={manifest?.id ?? NO_SCENE}
                    options={choices}
                    picture={drawSceneChoice}
                    columns={isWideWindow ? SHELF_COLUMNS.wide : SHELF_COLUMNS.narrow}
                    onChange={id => {
                        setSceneId(id === NO_SCENE ? null : id);
                        setTab('scene');
                    }}
                    label={t('ui.scene')}
                    maxHeight={250}
                    className="-mx-4"
                />
            </div>
        </>
    );

    return (
        <StudioWindow
            title={t('ui.scene')}
            onBack={onClose}
            backLabel={t('ui.back')}
            isDaylight={isDaylight}
            theme={theme}
            stage={stage}
        >
            <Tabs
                tabs={TABS.map(id => ({ id, label: t(TAB_LABEL_KEYS[id]) }))}
                activeId={tab}
                onSelect={id => setTab(id as Tab)}
                label={t('ui.scene')}
                className="px-4 pt-2 sm:px-6"
                action={(
                    <span className="pr-3 sm:pr-4">
                        <Button variant="quiet" disabled={!resetScene} onClick={() => resetScene?.()}>{t('ui.default')}</Button>
                    </span>
                )}
            />
            <StudioColumnBody>
                <div key={tab === 'scene' ? `scene:${manifest?.id ?? NO_SCENE}` : tab} className="st-page-in">
                    {tab === 'scene' && (manifest
                        ? <SceneOwnSettings manifest={manifest} />
                        : <p className="py-14 text-center text-[13px] text-[color:var(--st-t3)]">{t('ui.sceneNoSettings')}</p>)}
                    {tab === 'sound' && <SoundTracingGroup />}
                </div>
            </StudioColumnBody>
        </StudioWindow>
    );
};

export default SceneWindow;
