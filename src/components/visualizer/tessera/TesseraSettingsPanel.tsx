import React from 'react';
import { Group, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import type { VisualizerSettingsPanelProps } from '../definition';
import type { TesseraBackground, TesseraTuning } from './types';

// src/components/visualizer/tessera/TesseraSettingsPanel.tsx
// 方块字的设置面板：现在只有一组「画面」，里面是背景三选一。

const VIEW_GROUP: SettingsGroupDef = { id: 'vis-tessera-view', titleKey: 'options.tesseraViewSection' };

/** 三种背景的文案键，面板和播放面板的快捷胶囊共用。 */
export const TESSERA_BACKGROUND_LABEL_KEYS: Record<TesseraBackground, string> = {
    solid: 'options.tesseraBackgroundSolid',
    frame: 'options.tesseraBackgroundFrame',
    clear: 'options.tesseraBackgroundClear',
};

const TesseraSettingsPanel: React.FC<VisualizerSettingsPanelProps<TesseraTuning>> = ({
    t,
    tuning,
    onTuningChange,
}) => (
    <Group def={VIEW_GROUP}>
        <Row label={t('options.tesseraBackground')} note={t('options.tesseraBackgroundHint')}>
            <Segmented<TesseraBackground>
                value={tuning.background}
                options={[
                    { value: 'solid', label: t(TESSERA_BACKGROUND_LABEL_KEYS.solid) },
                    { value: 'frame', label: t(TESSERA_BACKGROUND_LABEL_KEYS.frame) },
                    { value: 'clear', label: t(TESSERA_BACKGROUND_LABEL_KEYS.clear) },
                ]}
                onChange={next => onTuningChange({ background: next })}
            />
        </Row>
    </Group>
);

export default TesseraSettingsPanel;
