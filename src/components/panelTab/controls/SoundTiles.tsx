import React from 'react';
import { Blend, Route, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { noteLoopButtonPress } from '../../../services/ponder/loopShuffleHint';
import { useAutomixSettingsStore } from '../../../stores/useAutomixSettingsStore';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { openHifiSignalPath } from '../../hifi/hifiPanelStore';
import { signalPathTone, verdictLabel } from '../../hifi/hifiSignalText';
import { useHifiSignalPath } from '../../hifi/useHifiSignalPath';
import { loopModeIcon, loopModeLabelName } from '../../shared/loopModeDisplay';
import { QuickTile } from './QuickTile';

// src/components/panelTab/controls/SoundTiles.tsx
// 音量下面的三块：循环（名字就是当前状态）、智能过渡、音频效果器（打开效果器窗口，处理开着时亮起）。

interface SoundTilesProps {
    loopMode: 'off' | 'all' | 'one';
    /** Receives the click so the handler can stop it from reaching the panel container. */
    onToggleLoop: (event?: React.MouseEvent) => void;
    loopToggleDisabled: boolean;
}

const SoundTiles: React.FC<SoundTilesProps> = ({ loopMode, onToggleLoop, loopToggleDisabled }) => {
    const { t } = useTranslation();
    const isEqualizerOn = useAudioSettingsStore(state => state.audioEqualizerSettings.enabled);
    const openAudioEqualizer = useAudioSettingsStore(state => state.openAudioEqualizer);
    const automixEnabled = useAutomixSettingsStore(state => state.automixEnabled);
    const toggleAutomix = useAutomixSettingsStore(state => state.handleToggleAutomix);
    // 不在 HiFi 路线上时为 null。HiFi 上智能过渡和效果器都被绕过，两块换成一块打开信号链路面板的格子。
    const hifiSignalPath = useHifiSignalPath();
    const LoopIcon = loopModeIcon(loopMode);

    return (
        <div className="mt-2 grid grid-cols-3 gap-2">
            <QuickTile
                kind="toggle"
                icon={<LoopIcon size={18} />}
                iconKey={loopMode}
                label={t(`player.${loopModeLabelName(loopMode)}`)}
                lit={loopMode !== 'off'}
                disabled={loopToggleDisabled}
                onClick={(event) => {
                    onToggleLoop(event);
                    noteLoopButtonPress();
                }}
            />
            {hifiSignalPath ? (
                // QuickTile 不收 className：外面包一层占两列，grid 让里面那层撑满。
                <div className="col-span-2 grid min-w-0">
                    <QuickTile
                        kind="open"
                        icon={<Route size={18} />}
                        label={t('hifi.player.signalPathTile', { verdict: verdictLabel(hifiSignalPath.verdict, t) })}
                        lit={signalPathTone(hifiSignalPath) === 'accent'}
                        aria-haspopup="dialog"
                        onClick={openHifiSignalPath}
                    />
                </div>
            ) : (
                <>
                    <QuickTile
                        kind="toggle"
                        icon={<Blend size={18} />}
                        label={t('ui.automix')}
                        lit={automixEnabled}
                        onClick={() => toggleAutomix(!automixEnabled)}
                    />
                    <QuickTile
                        kind="open"
                        icon={<SlidersHorizontal size={18} />}
                        label={t('ui.equalizerTitle')}
                        lit={isEqualizerOn}
                        data-ponder="audio-equalizer"
                        onClick={openAudioEqualizer}
                    />
                </>
            )}
        </div>
    );
};

export default SoundTiles;
