import React, { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { DEFAULT_NOMAND_BACKGROUND_TUNING, type MonetBackgroundImage, type NomandBackgroundSource, type NomandBackgroundTuning } from '../../../../types';
import { Button, Group, Reveal, Row, Segmented, type SettingsGroupDef } from '../../../modal/settings/kit';
import { percent, SliderRow, ToggleRow } from '../../panelRows';
import NomandBackgroundEffectSettings from './NomandBackgroundEffectSettings';

// src/components/visualizer/backgrounds/nomand/NomandBackgroundSettingsCard.tsx
// Edits the Paper shader background while reusing the shared custom background image asset: the
// picture and the layer over it in one group of the settings kit, the effect in a second.
const NOMAND_GROUP: SettingsGroupDef = { id: 'bg-nomand', titleKey: 'options.nomandBackgroundSettings' };

interface NomandBackgroundSettingsCardProps {
    t: (key: string) => string;
    tuning: NomandBackgroundTuning;
    onTuningChange?: (patch: Partial<NomandBackgroundTuning>) => void;
    monetBackgroundImage?: MonetBackgroundImage | null;
    onUploadMonetBackgroundImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetBackgroundImage?: () => Promise<void> | void;
    isLoadingMonetBackgroundImage?: boolean;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const NomandBackgroundSettingsCard: React.FC<NomandBackgroundSettingsCardProps> = ({
    t,
    tuning,
    onTuningChange,
    monetBackgroundImage,
    onUploadMonetBackgroundImage,
    onClearMonetBackgroundImage,
    isLoadingMonetBackgroundImage = false,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const resolvedTuning = { ...DEFAULT_NOMAND_BACKGROUND_TUNING, ...tuning };
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState('');

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
        <>
            <Group def={NOMAND_GROUP}>
                <Row label={t('options.nomandBackgroundSource')}>
                    <Segmented<NomandBackgroundSource>
                        value={resolvedTuning.imageSource}
                        options={[
                            { value: 'cover-derived', label: t('options.monetBackgroundSourceCover') },
                            {
                                value: 'uploaded-global',
                                label: t('options.monetBackgroundSourceUploaded'),
                                disabled: !monetBackgroundImage && !isLoadingMonetBackgroundImage,
                            },
                        ]}
                        onChange={setSource}
                    />
                </Row>
                <Row
                    label={t('options.monetUploadBackground')}
                    hint={feedback || monetBackgroundImage?.name || '-'}
                >
                    <Button
                        icon={Upload}
                        disabled={isLoadingMonetBackgroundImage || !onUploadMonetBackgroundImage}
                        onClick={() => inputRef.current?.click()}
                    >
                        {t('options.monetUploadBackground')}
                    </Button>
                    <Button
                        icon={Trash2}
                        disabled={!monetBackgroundImage || !onClearMonetBackgroundImage}
                        onClick={() => void onClearMonetBackgroundImage?.()}
                    >
                        {t('options.monetClearBackground')}
                    </Button>
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
                </Row>
                <ToggleRow
                    label={t('options.nomandBackgroundOverlay')}
                    note={t('options.nomandBackgroundOverlayDesc')}
                    checked={resolvedTuning.overlayEnabled}
                    onChange={overlayEnabled => onTuningChange?.({ overlayEnabled })}
                />
                <Reveal when={resolvedTuning.overlayEnabled}>
                    <SliderRow
                        sub
                        label={t('options.nomandBackgroundOverlayOpacity')}
                        value={resolvedTuning.overlayOpacity}
                        min={0}
                        max={1}
                        step={0.05}
                        format={percent}
                        onChange={overlayOpacity => onTuningChange?.({ overlayOpacity })}
                        onDragStart={onSliderPointerDown}
                        onDragEnd={onSliderCommit}
                    />
                </Reveal>
            </Group>

            <NomandBackgroundEffectSettings
                t={t}
                tuning={resolvedTuning}
                onTuningChange={onTuningChange}
                onSliderPointerDown={onSliderPointerDown}
                onSliderCommit={onSliderCommit}
            />
        </>
    );
};

export default NomandBackgroundSettingsCard;
