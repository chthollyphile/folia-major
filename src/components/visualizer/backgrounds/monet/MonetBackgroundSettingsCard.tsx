import React, { useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { ImagePlus, Trash2 } from 'lucide-react';
import {
    DEFAULT_MONET_BACKGROUND_TUNING,
    type MonetBackgroundImage,
    type MonetBackgroundLayout,
    type MonetBackgroundSource,
    type MonetBackgroundTuning,
    type MonetBackgroundWashColorMode,
} from '../../../../types';
import { Button, Group, PictureGrid, Reveal, Row, Segmented, Value, type SettingsGroupDef } from '../../../modal/settings/kit';
import { percent, SliderRow, ToggleRow } from '../../panelRows';

// src/components/visualizer/backgrounds/monet/MonetBackgroundSettingsCard.tsx
// Background settings for the shell-level Monet image layer: four groups of the settings kit.
const SOURCE_GROUP: SettingsGroupDef = { id: 'bg-monet-source', titleKey: 'options.monetGroupBackgroundSource' };
const LAYOUT_GROUP: SettingsGroupDef = { id: 'bg-monet-layout', titleKey: 'options.monetGroupLayoutPosition' };
const FILTERS_GROUP: SettingsGroupDef = { id: 'bg-monet-filters', titleKey: 'options.monetGroupFiltersPostProcessing' };
const TINT_GROUP: SettingsGroupDef = { id: 'bg-monet-tint', titleKey: 'options.monetGroupColorTintWash' };

interface MonetBackgroundSettingsCardProps {
    t: (key: string) => string;
    tuning?: MonetBackgroundTuning;
    onTuningChange?: (patch: Partial<MonetBackgroundTuning>) => void;
    monetBackgroundImage?: MonetBackgroundImage | null;
    onUploadMonetBackgroundImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetBackgroundImage?: () => Promise<void> | void;
    isLoadingMonetBackgroundImage?: boolean;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const clampValue = (value: number, min: number, max: number, fallback: number) => (
    Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

const normalizeHexInput = (value: string) => {
    const withoutHash = value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
        return `#${withoutHash.toLowerCase()}`;
    }

    return null;
};

/** Where the picture lies: on one half, fading into the page, or over all of it. */
const layoutPicture = (layout: MonetBackgroundLayout) => (
    <span
        className="absolute inset-0"
        style={{
            backgroundImage: layout === 'full-overlay'
                ? 'linear-gradient(var(--st-t3), var(--st-t3))'
                : 'linear-gradient(90deg, var(--st-t3) 30%, transparent 62%)',
        }}
    />
);

export const MonetBackgroundSettingsCard: React.FC<MonetBackgroundSettingsCardProps> = ({
    t,
    tuning = DEFAULT_MONET_BACKGROUND_TUNING,
    onTuningChange,
    monetBackgroundImage,
    onUploadMonetBackgroundImage,
    onClearMonetBackgroundImage,
    isLoadingMonetBackgroundImage = false,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const resolvedTuning = {
        backgroundSource: tuning.backgroundSource ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource,
        backgroundLayout: tuning.backgroundLayout ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout,
        backgroundBlurPx: clampValue(tuning.backgroundBlurPx ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx, 0, 60, DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx),
        backgroundOverlayOpacity: clampValue(tuning.backgroundOverlayOpacity ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity, 0, 1, DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity),
        backgroundGrayscale: clampValue(tuning.backgroundGrayscale ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale, 0, 1, DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale),
        backgroundSaturation: clampValue(tuning.backgroundSaturation ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation, 0, 2, DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation),
        backgroundWash: clampValue(tuning.backgroundWash ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash, 0, 1, DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash),
        backgroundHalfPaneOffsetX: clampValue(tuning.backgroundHalfPaneOffsetX ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX, -40, 40, DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX),
        backgroundWashColorMode: tuning.backgroundWashColorMode ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode,
        backgroundWashCustomColor: normalizeHexInput(tuning.backgroundWashCustomColor) ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashCustomColor,
        backgroundDriftEnabled: tuning.backgroundDriftEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftEnabled,
        backgroundDriftStrength: clampValue(tuning.backgroundDriftStrength ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength, 0, 1, DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength),
        backgroundStreaksEnabled: tuning.backgroundStreaksEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundStreaksEnabled,
    };
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        setFeedback(null);
        if (!files.length || !onUploadMonetBackgroundImage) {
            return;
        }

        const result = await onUploadMonetBackgroundImage(files);
        if (result.ok) {
            onTuningChange?.({ backgroundSource: 'uploaded-global' });
            setFeedback(files[0].name);
        } else {
            setFeedback(result.error || t('options.monetUploadBackground'));
        }
    };

    return (
        <>
            <Group def={SOURCE_GROUP}>
                <Row label={t('options.monetBackgroundSource')}>
                    <Segmented<MonetBackgroundSource>
                        value={resolvedTuning.backgroundSource}
                        options={[
                            { value: 'cover-derived', label: t('options.monetBackgroundSourceCover') },
                            {
                                value: 'uploaded-global',
                                label: t('options.monetBackgroundSourceUploaded'),
                                disabled: !monetBackgroundImage && !isLoadingMonetBackgroundImage,
                            },
                        ]}
                        onChange={(value) => onTuningChange?.({ backgroundSource: value })}
                    />
                </Row>
                <Row
                    label={t('options.monetUploadBackground')}
                    hint={feedback || monetBackgroundImage?.name || '-'}
                >
                    <Button
                        icon={ImagePlus}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isLoadingMonetBackgroundImage || !onUploadMonetBackgroundImage}
                    >
                        {t('options.monetUploadBackground')}
                    </Button>
                    <Button
                        icon={Trash2}
                        onClick={() => void onClearMonetBackgroundImage?.()}
                        disabled={!monetBackgroundImage || !onClearMonetBackgroundImage}
                    >
                        {t('options.monetClearBackground')}
                    </Button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                        className="hidden"
                        onChange={(event) => void handleFileChange(event)}
                    />
                </Row>
            </Group>

            <Group def={LAYOUT_GROUP}>
                <Row
                    label={t('options.monetBackgroundLayout')}
                    below={(
                        <PictureGrid<MonetBackgroundLayout>
                            className="-mx-4"
                            columns={4}
                            label={t('options.monetBackgroundLayout')}
                            value={resolvedTuning.backgroundLayout}
                            options={[
                                { value: 'half-pane-gradient', label: t('options.monetLayoutHalfPane') },
                                { value: 'full-overlay', label: t('options.monetLayoutFullOverlay') },
                            ]}
                            picture={layoutPicture}
                            onChange={(value) => onTuningChange?.({ backgroundLayout: value })}
                        />
                    )}
                />
                <Reveal when={resolvedTuning.backgroundLayout === 'half-pane-gradient'}>
                    <SliderRow
                        {...drag}
                        sub
                        label={t('options.monetHalfPaneOffsetX')}
                        value={resolvedTuning.backgroundHalfPaneOffsetX}
                        min={-40}
                        max={40}
                        step={2}
                        format={(value) => `${Math.round(value)}%`}
                        onChange={(value) => onTuningChange?.({ backgroundHalfPaneOffsetX: value })}
                    />
                </Reveal>
                <ToggleRow
                    label={t('options.monetBackgroundDriftEnabled')}
                    note={t('options.monetBackgroundDriftEnabledDesc')}
                    checked={resolvedTuning.backgroundDriftEnabled}
                    onChange={backgroundDriftEnabled => onTuningChange?.({ backgroundDriftEnabled })}
                />
                <Reveal when={resolvedTuning.backgroundDriftEnabled}>
                    <SliderRow
                        {...drag}
                        sub
                        label={t('options.monetBackgroundDriftStrength')}
                        value={resolvedTuning.backgroundDriftStrength}
                        min={0}
                        max={1}
                        step={0.05}
                        format={percent}
                        onChange={(value) => onTuningChange?.({ backgroundDriftStrength: value })}
                    />
                </Reveal>
            </Group>

            <Group def={FILTERS_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.monetBackgroundBlur')}
                    value={resolvedTuning.backgroundBlurPx}
                    min={0}
                    max={60}
                    step={2}
                    format={(value) => `${Math.round(value)}px`}
                    onChange={(value) => onTuningChange?.({ backgroundBlurPx: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.monetBackgroundSaturation')}
                    value={resolvedTuning.backgroundSaturation}
                    min={0}
                    max={2}
                    step={0.05}
                    format={percent}
                    onChange={(value) => onTuningChange?.({ backgroundSaturation: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.monetBackgroundGrayscale')}
                    value={resolvedTuning.backgroundGrayscale}
                    min={0}
                    max={1}
                    step={0.02}
                    format={percent}
                    onChange={(value) => onTuningChange?.({ backgroundGrayscale: value })}
                />
            </Group>

            <Group def={TINT_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.monetBackgroundOverlayOpacity')}
                    value={resolvedTuning.backgroundOverlayOpacity}
                    min={0}
                    max={1}
                    step={0.02}
                    format={percent}
                    onChange={(value) => onTuningChange?.({ backgroundOverlayOpacity: value })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.monetBackgroundWash')}
                    value={resolvedTuning.backgroundWash}
                    min={0}
                    max={1}
                    step={0.02}
                    format={percent}
                    onChange={(value) => onTuningChange?.({ backgroundWash: value })}
                />
                <ToggleRow
                    label={t('options.monetBackgroundStreaksEnabled')}
                    note={t('options.monetBackgroundStreaksEnabledDesc')}
                    checked={resolvedTuning.backgroundStreaksEnabled}
                    onChange={backgroundStreaksEnabled => onTuningChange?.({ backgroundStreaksEnabled })}
                />
                <Row label={t('options.monetBackgroundWashColorMode')}>
                    <Segmented<MonetBackgroundWashColorMode>
                        value={resolvedTuning.backgroundWashColorMode}
                        options={[
                            { value: 'theme', label: t('options.monetBackgroundWashTheme') },
                            { value: 'custom', label: t('options.monetBackgroundWashCustom') },
                        ]}
                        onChange={(value) => onTuningChange?.({ backgroundWashColorMode: value })}
                    />
                </Row>
                <Reveal when={resolvedTuning.backgroundWashColorMode === 'custom'}>
                    <Row
                        sub
                        label={t('options.monetBackgroundWashCustomColor')}
                        below={(
                            <HexColorPicker
                                color={resolvedTuning.backgroundWashCustomColor}
                                onChange={(value) => onTuningChange?.({ backgroundWashCustomColor: value })}
                                style={{ width: '100%', height: 180 }}
                            />
                        )}
                    >
                        <span className="h-4 w-4 rounded-full shadow-[0_0_0_1px_var(--st-line)]" style={{ backgroundColor: resolvedTuning.backgroundWashCustomColor }} />
                        <Value>{resolvedTuning.backgroundWashCustomColor.toUpperCase()}</Value>
                    </Row>
                </Reveal>
            </Group>
        </>
    );
};
