import React, { useSyncExternalStore } from 'react';
import { Camera, Orbit } from 'lucide-react';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import { cycleValue, QuickControlChip, QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { isMachiCameraBarOpen, subscribeMachiCameraBar, toggleMachiCameraBar } from './cameraBar';
import { MACHI_CAMERA_LABEL_KEYS } from './cameraControls';
import MachiSettingsPanel, {
    MACHI_SCENE_CHOICES,
    MACHI_SCENE_LABEL_KEYS,
    MACHI_TIME_LABEL_KEYS,
    MACHI_WEATHER_LABEL_KEYS,
} from './MachiSettingsPanel';
import machiTuning from './tuning';
import { MACHI_CAMERA_MODES, MACHI_TIMES_OF_DAY, MACHI_WEATHERS, type MachiTuning } from './types';

const VisualizerMachi = React.lazy(() => import('./VisualizerMachi'));

// src/components/visualizer/machi/entry.tsx
// Registers 町景 (Machi), an experimental three.js style: procedural miniature dioramas of a Japanese town (a
// convenience-store street corner for now) whose signs carry the lyrics — the current line lit up word by word on
// an LED screen, the next line on an LED ticker, the song on the shop signs. The scene, time of day and weather are
// tuning (each can be "auto"), and so are a pinned camera view per scene, a slow camera drift and the depth of field; the theme's colours and icons
// repaint the "chain". The panel's camera button opens a viewfinder bar on the player page (MachiCameraBar) to frame the shot there.

/** 控制面板里的摄影机按钮：开关播放页上的取景控制条，打开时收起面板，让出画面。 */
const MachiCameraBarButton: React.FC<{ label: string; onClosePanel?: () => void }> = ({ label, onClosePanel }) => {
    const open = useSyncExternalStore(subscribeMachiCameraBar, isMachiCameraBarOpen, isMachiCameraBarOpen);
    return (
        <QuickControlToggle
            active={open}
            label={label}
            onToggle={() => {
                toggleMachiCameraBar();
                if (!open) onClosePanel?.();
            }}
        >
            <Camera size={14} />
        </QuickControlToggle>
    );
};

export default defineVisualizer({
    mode: 'machi',
    order: 27,
    labelKey: 'ui.visualizerMachi',
    labelFallback: '町景',
    previewSeed: 'machi',
    previewStartOffset: 0,
    // 町景：一间小店，屋顶一块牌子，斜斜的雨
    glyph: (
        <>
            <path d="M4 20V11h11v9" />
            <path d="M6.5 11V8.5h6V11" opacity="0.6" />
            <path d="M9 20v-4.5h3V20" opacity="0.6" />
            <path d="M18 4l-1.2 3M21 6l-1.2 3M18.5 11l-1.2 3" opacity="0.5" />
        </>
    ),
    command: {
        title: 'Visualizer: Machi',
        description: 'Switch to the Machi town dioramas',
        keywords: ['machi', 'konbini', 'convenience store', 'town', 'street corner', 'diorama 3d', 'rain', '町景', '便利店', '街角', '雨夜'],
    },
    // The scene draws its own sky: no shared background under it.
    background: false,
    // 智能动感模式 (engine/beatFx.ts): the neon and the lights swell on the beats; each kick rings a ripple out over
    // the wet ground and each snare flashes the lyric screen (htdemucs_gpu drum hits).
    beatEffects: [
        {
            id: BEAT_EFFECT_IDS.machiNeonPulse,
            nameKey: 'options.beatEffect_machiNeonPulse',
            descKey: 'options.beatEffect_machiNeonPulseDesc',
            source: 'beats',
        },
        {
            id: BEAT_EFFECT_IDS.machiDrumRipple,
            nameKey: 'options.beatEffect_machiDrumRipple',
            descKey: 'options.beatEffect_machiDrumRippleDesc',
            source: 'drums',
        },
        {
            id: BEAT_EFFECT_IDS.machiScreenFlash,
            nameKey: 'options.beatEffect_machiScreenFlash',
            descKey: 'options.beatEffect_machiScreenFlashDesc',
            source: 'drums',
        },
    ],
    // Deliberately unkeyed on the seed: the runtime takes a track change in place (pixiRuntimeHost.ts).
    render: props => <VisualizerMachi {...props} machiTuning={machiTuning.read(props.visualizerTunings)} />,
    renderSettingsPanel: props => <MachiSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, onClosePanel, t }: VisualizerQuickControlsProps<MachiTuning>) => {
        const scene = t(MACHI_SCENE_LABEL_KEYS[tuning.scene]);
        const time = t(MACHI_TIME_LABEL_KEYS[tuning.timeOfDay]);
        const weather = t(MACHI_WEATHER_LABEL_KEYS[tuning.weather]);
        const camera = t(MACHI_CAMERA_LABEL_KEYS[tuning.camera]);
        return (
            <>
                <QuickControlChip
                    label={scene}
                    title={`${t('options.machiScene')}: ${scene}`}
                    onClick={() => onTuningChange({ scene: cycleValue(MACHI_SCENE_CHOICES, tuning.scene) })}
                />
                <QuickControlChip
                    label={time}
                    title={`${t('options.machiTimeOfDay')}: ${time}`}
                    onClick={() => onTuningChange({ timeOfDay: cycleValue(MACHI_TIMES_OF_DAY, tuning.timeOfDay) })}
                />
                <QuickControlChip
                    label={weather}
                    title={`${t('options.machiWeather')}: ${weather}`}
                    onClick={() => onTuningChange({ weather: cycleValue(MACHI_WEATHERS, tuning.weather) })}
                />
                {/* 拖到想要的视角再点它：切到自定义视角时，刚拖过的视角就固定下来。 */}
                <QuickControlChip
                    label={camera}
                    title={`${t('options.machiCameraMode')}: ${camera}`}
                    onClick={() => onTuningChange({ camera: cycleValue(MACHI_CAMERA_MODES, tuning.camera) })}
                />
                <QuickControlToggle
                    active={tuning.motion}
                    label={t('options.machiCameraMotion')}
                    onToggle={() => onTuningChange({ motion: !tuning.motion })}
                >
                    <Orbit size={14} />
                </QuickControlToggle>
                <MachiCameraBarButton label={t('options.machiCameraBar')} onClosePanel={onClosePanel} />
            </>
        );
    },
    ownFontSizeNoticeKey: 'options.machiFontSizeAutoNotice',
});
