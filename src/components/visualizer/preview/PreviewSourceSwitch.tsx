import React, { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented, Tooltip } from '../../modal/settings/kit';
import { settingsTokens } from '../../modal/settings/kit/kitTheme';

// src/components/visualizer/preview/PreviewSourceSwitch.tsx
// The choice laid over a lyric preview's top right, left of its pause button: the sample song built
// into the window, or what the player is showing now. The kit's own Segmented, on a dark plate of
// the pause button's colour, since it lies over the theme being previewed and not over the window.

export type PreviewSource = 'builtin' | 'live';

/** The kit's dark colours with white text, whatever the app's light or dark, as the pause button beside it. */
const PLATE_TOKENS = { ...settingsTokens(false), '--text-primary': '#ffffff' } as CSSProperties;

type PreviewSourceSwitchProps = {
    value: PreviewSource;
    onChange: (value: PreviewSource) => void;
    /** Live is chosen, but the player has no lyrics to show: the sample is drawn in its place. */
    liveEmpty: boolean;
    /** Where it sits; the default is the lyric style window's, beside its pause button. */
    className?: string;
};

const PreviewSourceSwitch: React.FC<PreviewSourceSwitchProps> = ({
    value,
    onChange,
    liveEmpty,
    className = 'absolute right-[60px] top-3 z-40 inline-flex',
}) => {
    const { t } = useTranslation();
    const options = useMemo(() => [
        { value: 'builtin' as const, label: t('options.previewSourceBuiltin') },
        { value: 'live' as const, label: t('options.previewSourceLive') },
    ], [t]);

    return (
        <Tooltip text={value === 'live' && liveEmpty ? t('options.previewSourceLiveEmpty') : t('options.previewSource')} className={className}>
            <div role="group" aria-label={t('options.previewSource')} className="rounded-lg bg-black/45" style={PLATE_TOKENS}>
                <Segmented value={value} options={options} onChange={onChange} />
            </div>
        </Tooltip>
    );
};

export default PreviewSourceSwitch;
