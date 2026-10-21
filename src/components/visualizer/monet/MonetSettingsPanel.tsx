import React, { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useVisualizerAssetStore } from '../../../stores/useVisualizerAssetStore';
import { DEFAULT_MONET_TUNING, type MonetAudioPlacement, type MonetAudioStyle, type MonetPortraitSource, type MonetTuning } from '../../../types';
import { Button, Group, PictureGrid, Reveal, Row, Segmented, type SettingsGroupDef } from '../../modal/settings/kit';
import { type VisualizerSettingsPanelProps } from '../definition';
import { SliderRow, times, ToggleRow } from '../panelRows';

// src/components/visualizer/monet/MonetSettingsPanel.tsx
// Monet-specific lyric, audio, and portrait controls, as three groups of the settings kit.
// Background controls live in the shared background panel.
const LYRICS_GROUP: SettingsGroupDef = { id: 'vis-monet-lyrics', titleKey: 'options.lyricsStyleSettings' };
const PORTRAIT_GROUP: SettingsGroupDef = { id: 'vis-monet-portrait', titleKey: 'options.cappellaAvatarSource' };
const AUDIO_GROUP: SettingsGroupDef = { id: 'vis-monet-audio', titleKey: 'options.monetAudioStyle' };

type MonetPortraitStyle = 'rectangular' | 'square';

const clampValue = (value: number, min: number, max: number, fallback: number) => (
    Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

/** The portrait's frame: tall, or square. */
const portraitStylePicture = (style: MonetPortraitStyle) => (
    <span className="absolute inset-0 grid place-items-center">
        <span className={`rounded-sm bg-[var(--st-t2)] ${style === 'square' ? 'aspect-square h-[56%]' : 'aspect-[3/4] h-[76%]'}`} />
    </span>
);

/** The spectrum at the bottom: bars, or one line. */
const audioStylePicture = (style: MonetAudioStyle) => (
    <svg viewBox="0 0 64 40" className="absolute inset-0 h-full w-full text-[color:var(--st-t2)]" fill="none" stroke="currentColor" strokeLinecap="round">
        {style === 'bar' ? (
            <path strokeWidth="3" d="M14 30V22M22 30V14M30 30V19M38 30V10M46 30V17M54 30V24" />
        ) : (
            <path strokeWidth="2" strokeLinejoin="round" d="M10 26L18 21L26 24L34 12L42 19L50 15L56 23" />
        )}
    </svg>
);

export const MonetSettingsPanel: React.FC<VisualizerSettingsPanelProps<MonetTuning>> = ({
    t,
    tuning: monetTuning = DEFAULT_MONET_TUNING,
    onTuningChange: onMonetTuningChange,
    settings: {
        handleUploadMonetPortraitImage: onUploadMonetPortraitImage,
        handleClearMonetPortraitImage: onClearMonetPortraitImage,
    },
    onSliderPointerDown,
    onSliderCommit,
}) => {
    // The listener's own portrait and whether it is still being read back: the style's own, so the panel takes them itself.
    const monetPortraitImage = useVisualizerAssetStore(state => state.monetPortraitImage);
    const isLoadingMonetPortraitImage = useVisualizerAssetStore(state => state.isLoadingMonetPortraitImage);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const resolvedTuning = {
        keywordColoringEnabled: monetTuning.keywordColoringEnabled ?? DEFAULT_MONET_TUNING.keywordColoringEnabled,
        showDescription: monetTuning.showDescription ?? DEFAULT_MONET_TUNING.showDescription,
        showAudioVisualization: monetTuning.showAudioVisualization ?? DEFAULT_MONET_TUNING.showAudioVisualization,
        audioStyle: monetTuning.audioStyle ?? DEFAULT_MONET_TUNING.audioStyle,
        audioPlacement: monetTuning.audioPlacement ?? 'bottom',
        audioGain: clampValue(monetTuning.audioGain ?? 1, 0.5, 2, 1),
        fontScale: clampValue(monetTuning.fontScale ?? DEFAULT_MONET_TUNING.fontScale, 0.7, 1.5, DEFAULT_MONET_TUNING.fontScale),
        portraitSource: monetTuning.portraitSource ?? DEFAULT_MONET_TUNING.portraitSource,
        portraitStyle: monetTuning.portraitStyle ?? DEFAULT_MONET_TUNING.portraitStyle ?? 'rectangular',
        showPortraitDragHanger: monetTuning.showPortraitDragHanger ?? DEFAULT_MONET_TUNING.showPortraitDragHanger,
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        setFeedback(null);
        if (!files.length || !onUploadMonetPortraitImage) {
            return;
        }

        const result = await onUploadMonetPortraitImage(files);
        if (result.ok) {
            onMonetTuningChange?.({ portraitSource: 'custom' });
            setFeedback(files[0].name);
        } else {
            setFeedback(result.error || t('options.monetUploadPortrait'));
        }
    };

    return (
        <>
            <Group def={LYRICS_GROUP}>
                <SliderRow
                    label={t('options.monetFontScale')}
                    value={resolvedTuning.fontScale}
                    min={0.7}
                    max={1.5}
                    step={0.05}
                    format={times}
                    onChange={(value) => onMonetTuningChange?.({ fontScale: value })}
                    onDragStart={onSliderPointerDown}
                    onDragEnd={onSliderCommit}
                />
                <ToggleRow
                    label={t('options.monetKeywordColoring')}
                    checked={resolvedTuning.keywordColoringEnabled}
                    onChange={(value) => onMonetTuningChange?.({ keywordColoringEnabled: value })}
                />
                <ToggleRow
                    label={t('options.monetShowDescription')}
                    checked={resolvedTuning.showDescription}
                    onChange={(value) => onMonetTuningChange?.({ showDescription: value })}
                />
            </Group>

            <Group def={PORTRAIT_GROUP}>
                <Row label={t('options.monetPortraitSource')}>
                    <Segmented<MonetPortraitSource>
                        value={resolvedTuning.portraitSource}
                        options={[
                            { value: 'cover', label: t('options.monetPortraitSourceCover') },
                            {
                                value: 'custom',
                                label: t('options.monetPortraitSourceCustom'),
                                disabled: !monetPortraitImage && !isLoadingMonetPortraitImage,
                            },
                        ]}
                        onChange={(value) => onMonetTuningChange?.({ portraitSource: value })}
                    />
                </Row>
                <Row
                    label={t('options.monetUploadPortrait')}
                    hint={feedback || monetPortraitImage?.name || '-'}
                >
                    <Button
                        icon={ImagePlus}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isLoadingMonetPortraitImage || !onUploadMonetPortraitImage}
                    >
                        {t('options.monetUploadPortrait')}
                    </Button>
                    <Button
                        icon={Trash2}
                        onClick={() => void onClearMonetPortraitImage?.()}
                        disabled={!monetPortraitImage || !onClearMonetPortraitImage}
                    >
                        {t('options.monetClearPortrait')}
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                        className="hidden"
                        onChange={(event) => void handleFileChange(event)}
                    />
                </Row>
                <Row
                    label={t('options.monetPortraitStyle')}
                    below={(
                        <PictureGrid<MonetPortraitStyle>
                            className="-mx-4"
                            columns={4}
                            label={t('options.monetPortraitStyle')}
                            value={resolvedTuning.portraitStyle}
                            options={[
                                { value: 'rectangular', label: t('options.monetPortraitStyleRectangular') },
                                { value: 'square', label: t('options.monetPortraitStyleSquare') },
                            ]}
                            picture={portraitStylePicture}
                            onChange={(value) => onMonetTuningChange?.({ portraitStyle: value })}
                        />
                    )}
                />
                <ToggleRow
                    label={t('options.monetPortraitDragHanger')}
                    checked={resolvedTuning.showPortraitDragHanger ?? true}
                    onChange={(value) => onMonetTuningChange?.({ showPortraitDragHanger: value })}
                />
            </Group>

            <Group def={AUDIO_GROUP}>
                <ToggleRow
                    label={t('options.monetShowAudioVisualization')}
                    checked={resolvedTuning.showAudioVisualization}
                    onChange={(value) => onMonetTuningChange?.({ showAudioVisualization: value })}
                />
                <Reveal when={resolvedTuning.showAudioVisualization}>
                    <Row
                        sub
                        label={t('options.monetAudioPlacement')}
                        hint={t('options.monetAudioPlacementHint')}
                    >
                        <Segmented<MonetAudioPlacement>
                            value={resolvedTuning.audioPlacement}
                            options={[
                                { value: 'bottom', label: t('options.monetAudioPlacementBottom') },
                                { value: 'lyrics', label: t('options.monetAudioPlacementLyrics') },
                            ]}
                            onChange={(value) => onMonetTuningChange?.({ audioPlacement: value })}
                        />
                    </Row>
                    <Row
                        sub
                        label={t('options.monetAudioStyle')}
                        below={(
                            <PictureGrid<MonetAudioStyle>
                                className="-mx-4"
                                columns={4}
                                label={t('options.monetAudioStyle')}
                                value={resolvedTuning.audioStyle}
                                options={[
                                    { value: 'bar', label: t('options.monetAudioStyleBar') },
                                    { value: 'line', label: t('options.monetAudioStyleLine') },
                                ]}
                                picture={audioStylePicture}
                                onChange={(value) => onMonetTuningChange?.({ audioStyle: value })}
                            />
                        )}
                    />
                    <SliderRow
                        sub
                        label={t('options.monetAudioGain')}
                        value={resolvedTuning.audioGain}
                        min={0.5}
                        max={2}
                        step={0.05}
                        format={times}
                        onChange={(value) => onMonetTuningChange?.({ audioGain: value })}
                        onDragStart={onSliderPointerDown}
                        onDragEnd={onSliderCommit}
                    />
                </Reveal>
            </Group>
        </>
    );
};
