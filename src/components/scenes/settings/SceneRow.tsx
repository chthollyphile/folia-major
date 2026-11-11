import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clapperboard } from 'lucide-react';
import { resolveFoliumLabel } from '../../../mods/params/params';
import ModeStepperRow from '../../panelTab/controls/ModeStepperRow';
import { QuickControlChip } from '../../shared/QuickControlChip';
import type { SceneManifest } from '../definition';
import { useChosenScene, useSceneList } from '../registry';
import SceneSettingsPanel from './SceneSettingsPanel';
import { useSceneSettingsStore } from './useSceneSettingsStore';

// src/components/scenes/settings/SceneRow.tsx
// 播放面板外观区的「场景」一行：关（普通播放页）或名单里的一个场景；场景两种都允许时，下面一行是歌词、荧幕画面的来源开关。
// 选了场景时还有一个「场景设置」，打开画质、场景自己的设置和座位图。名单里一个场景都没有时整行不出现。

const NO_SCENE = 'none';

export const sceneLabel = (manifest: SceneManifest, language: string) => resolveFoliumLabel(manifest.name, language, manifest.id);

const drawGlyph = () => <Clapperboard size={18} />;

interface SceneRowProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenMore: () => void;
}

const SceneRow: React.FC<SceneRowProps> = ({ open, onOpenChange, onOpenMore }) => {
    const { t, i18n } = useTranslation();
    const scenes = useSceneList();
    const chosen = useChosenScene();
    const setSceneId = useSceneSettingsStore(state => state.setSceneId);
    const settingsChipRef = useRef<HTMLButtonElement>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    if (scenes.length === 0) return null;

    const choices = [
        { value: NO_SCENE, label: t('ui.sceneNone') },
        ...scenes.map(scene => ({ value: scene.manifest.id, label: sceneLabel(scene.manifest, i18n.language) })),
    ];
    const value = chosen?.manifest.id ?? NO_SCENE;
    const select = (next: string) => setSceneId(next === NO_SCENE ? null : next);
    const step = (direction: -1 | 1) => {
        const index = choices.findIndex(choice => choice.value === value);
        select(choices[(index + direction + choices.length) % choices.length].value);
    };

    const manifest = chosen?.manifest;
    const params = manifest ? (
        <>
            <QuickControlChip
                buttonRef={settingsChipRef}
                expanded={settingsOpen}
                label={t('ui.sceneSettings')}
                title={t('ui.sceneSettings')}
                onClick={() => setSettingsOpen(value => !value)}
            />
        </>
    ) : null;

    return (
        <>
            <ModeStepperRow<string>
                value={value}
                options={choices}
                onSelect={select}
                onStep={step}
                renderGlyph={drawGlyph}
                renderPicture={choice => (
                    <div className="flex h-full w-full items-center justify-center gap-2 text-sm opacity-80">
                        <Clapperboard size={16} />
                        {choices.find(entry => entry.value === choice)?.label}
                    </div>
                )}
                caption={t('ui.scene')}
                moreLabel={t('ui.moreSettings')}
                onOpenMore={onOpenMore}
                open={open}
                onOpenChange={onOpenChange}
                params={params}
            />
            {manifest && (
                <SceneSettingsPanel manifest={manifest} anchorRef={settingsChipRef} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            )}
        </>
    );
};

export default SceneRow;
