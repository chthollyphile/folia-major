import React, { useState } from 'react';
import { Check, FileCode2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { computeHasUploadedObsAsset } from '../../services/obs/visualSettingsConfig';
import { buildObsCustomCss } from '../../services/obs/obsCustomCss';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';

interface ObsCopyCssButtonProps {
    disabled?: boolean;
    // Padding/sizing for the button, matching the surrounding context (header vs full-width row).
    buttonClassName?: string;
    // Layout for the wrapper. Inline by default; the controls panel stretches it to the row.
    containerClassName?: string;
}

// Companion to ObsCopyUrlButton: copies the OBS Custom CSS snippet that carries the uploaded assets
// the cfg URL cannot (background / portrait). Self-gating -- renders nothing unless an uploaded asset
// is actually in use, so it never clutters the common case.
export const ObsCopyCssButton: React.FC<ObsCopyCssButtonProps> = ({ disabled, buttonClassName, containerClassName }) => {
    const { t } = useTranslation();
    // The inputs live in two stores now, so the test is composed from both narrow reads.
    const visualizerInputs = useVisualizerSettingsStore(useShallow(state => ({
        monetBackgroundTuning: state.monetBackgroundTuning,
        nomandBackgroundTuning: state.nomandBackgroundTuning,
        monetTuning: state.monetTuning,
        cappellaTuning: state.cappellaTuning,
    })));
    const assetInputs = useVisualizerAssetStore(useShallow(state => ({
        monetBackgroundImage: state.monetBackgroundImage,
        monetPortraitImage: state.monetPortraitImage,
        cappellaCustomEmojiImages: state.cappellaCustomEmojiImages,
        cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
    })));
    const hasAsset = computeHasUploadedObsAsset({ ...visualizerInputs, ...assetInputs });
    const [copied, setCopied] = useState(false);

    if (!hasAsset) {
        return null;
    }

    const handleCopy = async () => {
        try {
            const result = await buildObsCustomCss();
            if (!result) {
                setStatusMessage({ type: 'error', text: t('status.copyFailed') });
                return;
            }
            await navigator.clipboard.writeText(result.css);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
            const hintText = result.degradedGifCount > 0
                ? t('options.obsCssCopiedHintDegraded', { count: result.degradedGifCount })
                : t('options.obsCssCopiedHint');
            setStatusMessage({ type: 'info', text: hintText });
        } catch (err) {
            console.error('Failed to copy OBS CSS:', err);
            setStatusMessage({ type: 'error', text: t('status.copyFailed') });
        }
    };

    const baseBtn = 'text-xs font-medium flex items-center gap-1.5 bg-white/10 hover:bg-white/15 active:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-lg';

    return (
        <div className={containerClassName ?? 'inline-flex'}>
            <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={disabled}
                title={t('options.copyObsCssHint')}
                className={`${baseBtn} justify-center ${buttonClassName ?? 'px-3 py-2'}`}
                style={{ color: copied ? '#86efac' : 'var(--text-primary)' }}
            >
                {copied ? <Check size={13} className="shrink-0" /> : <FileCode2 size={13} className="shrink-0" />}
                <span className="whitespace-nowrap">{copied ? t('status.copied') : t('options.copyObsCss')}</span>
            </button>
        </div>
    );
};
