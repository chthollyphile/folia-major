import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { SubtitleContentMode, Theme } from '../../../types';
import { useTypographySettingsStore } from '../../../stores/useTypographySettingsStore';
import { Reveal, Row, Select, Toggle } from '../../modal/settings/kit';
import { GROUP_CARD_CLASS } from '../../modal/settings/kit/Group';
import { settingsTokens } from '../../modal/settings/kit/kitTheme';
import { kitMotionTokens, useKitReducedMotion } from '../../modal/settings/kit/motion';
import { percent, SliderRow } from '../../visualizer/panelRows';
import SubtitleOverlayRowsSetting from '../../visualizer/window/SubtitleOverlayRowsSetting';

// src/components/command-palette/surfaces/SubtitleSettingsSurfaceView.tsx
// The subtitle command's panel: the bottom subtitle on or off, how many rows it has and what each row
// shows, its opacity, backdrop, size and whether upcoming lines are blurred, and the 副字幕 the
// self-laid-out lyric styles (and the harmony line) show. A link under the card opens the lyric style
// window's subtitle tab for everything else.
//
// The rows and the 副字幕 choice are the lyric style window's own controls, in its order, so the palette
// and that window edit the same settings the same way. Values come straight from the typography store.

type SubtitleSettingsSurfaceViewProps = {
    isDaylight: boolean;
    theme: Theme;
    onOpenMoreSettings: () => void;
};

export default function SubtitleSettingsSurfaceView({ isDaylight, theme, onOpenMoreSettings }: SubtitleSettingsSurfaceViewProps) {
    const { t } = useTranslation();
    const reducedMotion = useKitReducedMotion();
    const subtitles = useTypographySettingsStore(useShallow(state => ({
        isOverlayHidden: state.hidePlayerTranslationSubtitle,
        layout: state.subtitleOverlayLayout,
        opacity: state.subtitleOverlayOpacity,
        hasBackground: state.subtitleOverlayBackground,
        contentMode: state.subtitleContentMode,
        fontScale: state.subtitleFontScale,
        blursUpcoming: state.subtitleUpcomingLyricsBlur,
        setOverlayHidden: state.handleToggleHidePlayerTranslationSubtitle,
        setLayout: state.handleSetSubtitleOverlayLayout,
        setOpacity: state.handleSetSubtitleOverlayOpacity,
        setBackground: state.handleToggleSubtitleOverlayBackground,
        setContentMode: state.handleSetSubtitleContentMode,
        setFontScale: state.handleSetSubtitleFontScale,
        setBlursUpcoming: state.handleToggleSubtitleUpcomingLyricsBlur,
    })));

    return (
        <div
            // A settings window of its own inside the palette: the kit's colours, motion and focus ring
            // all hang off `st-window` and these variables, which the palette does not set.
            className="st-window flex h-full justify-center overflow-y-auto px-4 py-6 text-[color:var(--st-t1)]"
            style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(reducedMotion) }}
            data-testid="subtitle-settings-surface"
        >
            <div className="w-full max-w-lg self-start">
                <div className={GROUP_CARD_CLASS}>
                    <Row label={t('options.hidePlayerTranslationSubtitle')} note={t('options.hidePlayerTranslationSubtitleDesc')}>
                        <Toggle checked={subtitles.isOverlayHidden} onChange={subtitles.setOverlayHidden} />
                    </Row>
                    <Reveal when={!subtitles.isOverlayHidden}>
                        <SubtitleOverlayRowsSetting t={t} layout={subtitles.layout} onChange={subtitles.setLayout} />
                        {/* Same range and step as the lyric style window's slider; the store clamps to it too. */}
                        <SliderRow
                            label={t('options.subtitleOverlayOpacity')}
                            value={subtitles.opacity}
                            min={0.2}
                            max={1}
                            step={0.05}
                            format={percent}
                            onChange={subtitles.setOpacity}
                        />
                        <Row label={t('options.subtitleOverlayBackground')} note={t('options.subtitleOverlayBackgroundDesc')}>
                            <Toggle checked={subtitles.hasBackground} onChange={subtitles.setBackground} />
                        </Row>
                        <Row label={t('options.subtitleUpcomingLyricsBlur')}>
                            <Toggle checked={subtitles.blursUpcoming} onChange={subtitles.setBlursUpcoming} />
                        </Row>
                    </Reveal>
                    {/* Same range and step as the lyric style window's 字幕缩放; it also sizes the 副字幕 below. */}
                    <SliderRow
                        label={t('options.subtitleFontScale')}
                        value={subtitles.fontScale}
                        min={0.85}
                        max={1.4}
                        step={0.05}
                        format={percent}
                        onChange={subtitles.setFontScale}
                    />
                    <Row label={t('options.subtitleContentMode')} note={t('options.subtitleContentModeDesc')}>
                        <Select<SubtitleContentMode>
                            value={subtitles.contentMode}
                            options={[
                                { label: t('options.subtitleContentTranslation'), value: 'translation' },
                                { label: t('options.subtitleContentRomanization'), value: 'romanization' },
                                { label: t('options.subtitleContentBoth'), value: 'both' },
                                { label: t('options.subtitleContentNone'), value: 'none' },
                            ]}
                            onChange={subtitles.setContentMode}
                        />
                    </Row>
                </div>
                <div className="mt-2 flex justify-end">
                    <button
                        type="button"
                        onClick={onOpenMoreSettings}
                        className="st-t-fast inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-[color:var(--st-t3)] transition-colors hover:text-[color:var(--st-t1)]"
                    >
                        {t('commandPalette.subtitleSettingsMore')}
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
}
