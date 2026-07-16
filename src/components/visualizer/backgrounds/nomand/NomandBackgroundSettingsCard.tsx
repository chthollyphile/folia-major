import React, { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import type { MonetBackgroundImage, NomandBackgroundDitheringType, NomandBackgroundSource, NomandBackgroundTuning, Theme } from '../../../../types';
import { colorWithAlpha } from '../../colorMix';
import BackgroundToggleRow from '../BackgroundToggleRow';

// src/components/visualizer/backgrounds/nomand/NomandBackgroundSettingsCard.tsx
// Edits the Paper dithering background while reusing the shared custom background image asset.

interface NomandBackgroundSettingsCardProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    tuning: NomandBackgroundTuning;
    onTuningChange?: (patch: Partial<NomandBackgroundTuning>) => void;
    monetBackgroundImage?: MonetBackgroundImage | null;
    onUploadMonetBackgroundImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetBackgroundImage?: () => Promise<void> | void;
    isLoadingMonetBackgroundImage?: boolean;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const DITHERING_TYPES: NomandBackgroundDitheringType[] = ['2x2', '4x4', '8x8'];

const NomandBackgroundSettingsCard: React.FC<NomandBackgroundSettingsCardProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    tuning,
    onTuningChange,
    monetBackgroundImage,
    onUploadMonetBackgroundImage,
    onClearMonetBackgroundImage,
    isLoadingMonetBackgroundImage = false,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState('');
    const borderColor = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16);
    const selectedBg = colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16);

    const setSource = (imageSource: NomandBackgroundSource) => {
        onTuningChange?.({ imageSource });
    };

    const handleFiles = async (files: File[]) => {
        if (!files.length || !onUploadMonetBackgroundImage) return;
        const result = await onUploadMonetBackgroundImage(files);
        setFeedback(result.ok ? t('options.nomandBackgroundUploadSuccess') : result.error ?? t('options.nomandBackgroundUploadFailed'));
        if (result.ok) setSource('uploaded-global');
    };

    return (
        <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor }}>
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                    {t('options.nomandBackgroundSettings')}
                </div>
                <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                    {t('options.nomandBackgroundSettingsDesc')}
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-sm" style={{ color: theme.primaryColor }}>
                    {t('options.nomandBackgroundSource')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {([
                        ['cover-derived', t('options.monetBackgroundSourceCover')],
                        ['uploaded-global', t('options.monetBackgroundSourceUploaded')],
                    ] as const).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            disabled={value === 'uploaded-global' && !monetBackgroundImage && !isLoadingMonetBackgroundImage}
                            onClick={() => setSource(value)}
                            className="rounded-2xl border px-3 py-2 text-sm disabled:opacity-40"
                            style={{
                                borderColor: tuning.imageSource === value ? theme.accentColor : borderColor,
                                backgroundColor: tuning.imageSource === value ? selectedBg : 'transparent',
                                color: theme.primaryColor,
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => {
                            void handleFiles(Array.from(event.target.files ?? []));
                            event.target.value = '';
                        }}
                    />
                    <button
                        type="button"
                        disabled={isLoadingMonetBackgroundImage || !onUploadMonetBackgroundImage}
                        onClick={() => inputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs disabled:opacity-40"
                        style={{ borderColor, color: theme.primaryColor }}
                    >
                        <Upload size={14} />
                        {t('options.monetUploadBackground')}
                    </button>
                    <button
                        type="button"
                        disabled={!monetBackgroundImage || !onClearMonetBackgroundImage}
                        onClick={() => void onClearMonetBackgroundImage?.()}
                        className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs disabled:opacity-40"
                        style={{ borderColor, color: theme.secondaryColor }}
                    >
                        <Trash2 size={14} />
                        {t('options.monetClearBackground')}
                    </button>
                </div>
                <div className="truncate text-xs opacity-60" style={{ color: theme.secondaryColor }}>
                    {feedback || monetBackgroundImage?.name || '-'}
                </div>
            </div>

            <div className="space-y-2">
                <div className="text-sm" style={{ color: theme.primaryColor }}>
                    {t('options.nomandBackgroundDitheringType')}
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {DITHERING_TYPES.map(type => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => onTuningChange?.({ ditheringType: type })}
                            className="rounded-xl border px-2 py-2 text-xs"
                            style={{
                                borderColor: tuning.ditheringType === type ? theme.accentColor : borderColor,
                                backgroundColor: tuning.ditheringType === type ? selectedBg : 'transparent',
                                color: theme.primaryColor,
                            }}
                        >
                            {type}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-3 rounded-2xl border p-3" style={{ borderColor }}>
                <BackgroundToggleRow
                    label={t('options.nomandBackgroundOverlay')}
                    description={t('options.nomandBackgroundOverlayDesc')}
                    checked={tuning.overlayEnabled}
                    onChange={overlayEnabled => onTuningChange?.({ overlayEnabled })}
                    theme={theme}
                />
                <label className={`block space-y-2 ${tuning.overlayEnabled ? '' : 'opacity-45'}`}>
                    <span className="flex justify-between text-sm" style={{ color: theme.primaryColor }}>
                        <span>{t('options.nomandBackgroundOverlayOpacity')}</span>
                        <span className="font-mono opacity-70">{Math.round(tuning.overlayOpacity * 100)}%</span>
                    </span>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={tuning.overlayOpacity}
                        disabled={!tuning.overlayEnabled}
                        onChange={event => onTuningChange?.({ overlayOpacity: Number(event.target.value) })}
                        onPointerDown={onSliderPointerDown}
                        onPointerUp={onSliderCommit}
                        className={rangeInputClass}
                    />
                </label>
            </div>

            <label className="block space-y-2">
                <span className="flex justify-between text-sm" style={{ color: theme.primaryColor }}>
                    <span>{t('options.nomandBackgroundSize')}</span>
                    <span className="font-mono opacity-70">{tuning.size.toFixed(1)}</span>
                </span>
                <input
                    type="range"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={tuning.size}
                    onChange={event => onTuningChange?.({ size: Number(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </label>

            <label className="block space-y-2">
                <span className="flex justify-between text-sm" style={{ color: theme.primaryColor }}>
                    <span>{t('options.nomandBackgroundColorSteps')}</span>
                    <span className="font-mono opacity-70">{tuning.colorSteps}</span>
                </span>
                <input
                    type="range"
                    min="1"
                    max="7"
                    step="1"
                    value={tuning.colorSteps}
                    onChange={event => onTuningChange?.({ colorSteps: Number(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </label>

            {([
                ['originalColors', t('options.nomandBackgroundOriginalColors')],
                ['inverted', t('options.nomandBackgroundInverted')],
            ] as const).map(([key, label]) => (
                <BackgroundToggleRow
                    key={key}
                    label={label}
                    checked={tuning[key]}
                    onChange={checked => onTuningChange?.({ [key]: checked })}
                    theme={theme}
                />
            ))}
        </div>
    );
};

export default NomandBackgroundSettingsCard;
