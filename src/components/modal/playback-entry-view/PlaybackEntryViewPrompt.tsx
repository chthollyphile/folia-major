import React, { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PlaybackEntryViewOptions } from './PlaybackEntryViewOptions';
import { LibrarySuiteOnboardingOptions } from './LibrarySuiteOnboardingOptions';
import { SourcesOnboardingOptions } from './SourcesOnboardingOptions';
import { submitSourcesOnboarding } from './sourcesOnboarding';
import { usePlaybackEntryViewStore, type StartupPromptPage } from '../../../stores/usePlaybackEntryViewStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { resolveReducedMotion, useMotionSettingsStore } from '../../../stores/useMotionSettingsStore';
import { confirmOnboardingLibrarySuite } from '../../../library/app/librarySuiteChoice';
import { OVERLAY_CALM_TRANSITION, OVERLAY_TRANSITION } from '../../shared/overlayEntranceMotion';
import { openSettings } from '../../../stores/useSettingsModalStore';
import { settingsAnchorSubview } from '../../../utils/settingsAnchorModel';
import type { Theme } from '../../../types';

// src/components/modal/playback-entry-view/PlaybackEntryViewPrompt.tsx
// Asks once, after the release notes are dismissed, how the library should look and which view
// pressing play should open — two pages in one dialog, with Next / Back between them.
//
// The pages are whatever is still unanswered when it opens (the store decides, see
// requestPlaybackEntryViewPrompt): page 1 (library suite: grid / bravais) when both suites exist in this build
// and it has never been shown on this install — every install sees it once (2026-10-10), including those that
// answered the older single-page prompt, which then get page 1 alone; page 2 is the original playback-entry-view
// question, when that has not been chosen yet. Each card writes its preference the moment it is picked, through
// the same path as the options page, so Back / Next never lose a choice.
//
// A fresh desktop profile also gets a sources page first (Folium 2.0 plan §5.3, sourcesOnboarding.ts): which
// platforms it listens on, nothing ticked to begin with. Its ticks are only kept until the dialog closes; then the
// whole answer goes to the main process at once (submitSourcesOnboarding).
//
// It closes as answered whichever way it is dismissed, including the backdrop: both preferences have working
// defaults, so a listener who does not care must not be asked a second time. Closing a dialog that showed page 1
// also records the suite in effect as the listener's choice (confirmOnboardingLibrarySuite); one that showed the
// sources page hands its ticks over, ticked or not.

type PromptPage = StartupPromptPage;

type PageMotionContext = { direction: 1 | -1; calm: boolean };

const PAGE_OFFSET_PX = 28;

// Next slides the new page in from the right, Back from the left; with micro-motion reduced it
// only cross-fades, the same fallback the other overlays use.
const pageMotion = {
    enter: ({ direction, calm }: PageMotionContext) => ({ opacity: 0, x: calm ? 0 : direction * PAGE_OFFSET_PX }),
    center: { opacity: 1, x: 0 },
    exit: ({ direction, calm }: PageMotionContext) => ({ opacity: 0, x: calm ? 0 : -direction * PAGE_OFFSET_PX }),
};

export const PlaybackEntryViewPrompt: React.FC<{ theme?: Theme | null }> = ({ theme }) => {
    const isOpen = usePlaybackEntryViewStore(state => state.isPlaybackEntryViewPromptOpen);
    const pages = usePlaybackEntryViewStore(state => state.promptPages);
    const closeStoredPrompt = usePlaybackEntryViewStore(state => state.closePlaybackEntryViewPrompt);
    const closePrompt = useCallback(() => {
        const shownPages = usePlaybackEntryViewStore.getState().promptPages;
        if (shownPages.includes('library-suite')) confirmOnboardingLibrarySuite();
        if (shownPages.includes('sources')) void submitSourcesOnboarding();
        closeStoredPrompt();
    }, [closeStoredPrompt]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
                    onClick={closePrompt}
                >
                    {/* The panel only mounts while open, so every opening starts again on the first page. */}
                    <PromptPanel theme={theme} pages={pages} onClose={closePrompt} />
                </motion.div>
            )}
        </AnimatePresence>
    );
};

const PromptPanel: React.FC<{ theme?: Theme | null; pages: readonly PromptPage[]; onClose: () => void }> = ({ theme, pages, onClose }) => {
    const { t } = useTranslation();
    const playbackEntryView = usePlaybackEntryViewStore(state => state.playbackEntryView);
    const setPlaybackEntryView = usePlaybackEntryViewStore(state => state.setPlaybackEntryView);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const calm = useMotionSettingsStore(state => resolveReducedMotion(state, 'uiMicroMotion'));

    // Fixed for one opening (the store sets them when it opens).
    const [pageIndex, setPageIndex] = useState(0);
    const [direction, setDirection] = useState<1 | -1>(1);
    const page = pages[pageIndex];
    const isLastPage = pageIndex === pages.length - 1;

    const goTo = (nextIndex: number) => {
        setDirection(nextIndex > pageIndex ? 1 : -1);
        setPageIndex(Math.max(0, Math.min(pages.length - 1, nextIndex)));
    };

    const accentColor = theme?.accentColor || (isDaylight ? '#3b82f6' : '#60a5fa');
    const bgClass = isDaylight ? 'bg-white border-zinc-200' : 'bg-[#18181b] border-zinc-800';
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-zinc-50';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const btnClass = isDaylight
        ? 'bg-gradient-to-r from-zinc-800 to-zinc-900 hover:from-zinc-700 hover:to-zinc-800 text-white shadow-xl shadow-zinc-900/10'
        : 'bg-gradient-to-r from-zinc-100 to-white hover:from-white hover:to-zinc-100 text-zinc-900 shadow-xl shadow-white/10';
    const secondaryBtnClass = isDaylight
        ? 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
        : 'bg-white/[0.06] hover:bg-white/10 text-zinc-200';
    const namespace = page === 'sources' ? 'sourcesOnboarding' : page === 'library-suite' ? 'librarySuiteOnboarding' : 'playbackEntryView';
    const motionContext: PageMotionContext = { direction, calm };

    return (
        <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="playback-entry-view-prompt-title"
            data-testid="playback-entry-view-prompt"
            data-onboarding-page={page}
            className={`${bgClass} border rounded-[2rem] max-w-lg w-full max-h-[85vh] p-8 shadow-2xl relative overflow-y-auto overflow-x-hidden hide-scrollbar`}
        >
            <AnimatePresence mode="wait" initial={false} custom={motionContext}>
                <motion.div
                    key={page}
                    custom={motionContext}
                    variants={pageMotion}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={calm ? OVERLAY_CALM_TRANSITION : OVERLAY_TRANSITION}
                >
                    <div id="playback-entry-view-prompt-title" className={`text-lg font-semibold ${textPrimary}`}>
                        {t(`${namespace}.title`)}
                    </div>
                    <div className={`mt-2 text-sm leading-relaxed ${textSecondary}`}>
                        {t(`${namespace}.description`)}
                    </div>

                    <div className="mt-5">
                        {page === 'sources' ? (
                            <SourcesOnboardingOptions
                                isDaylight={isDaylight}
                                accentColor={accentColor}
                                // Navidrome (not a source mod): the dialog closes as answered (these ticks go to the main
                                // process, the other pages keep their defaults) and its connection in Settings opens.
                                onOpenNavidrome={() => {
                                    onClose();
                                    openSettings('options', settingsAnchorSubview('navidrome'), null, 'navidrome');
                                }}
                            />
                        ) : page === 'library-suite' ? (
                            <LibrarySuiteOnboardingOptions isDaylight={isDaylight} accentColor={accentColor} />
                        ) : (
                            <PlaybackEntryViewOptions
                                value={playbackEntryView}
                                onChange={setPlaybackEntryView}
                                isDaylight={isDaylight}
                                accentColor={accentColor}
                            />
                        )}
                    </div>

                    <div className={`mt-5 text-[11px] ${textSecondary}`}>
                        {t(`${namespace}.settingsHint`)}
                    </div>
                </motion.div>
            </AnimatePresence>

            <div className="mt-5 flex items-center justify-between gap-3">
                {pages.length > 1 ? (
                    <div
                        className="flex items-center gap-1.5"
                        role="img"
                        aria-label={t('playbackEntryView.step', { current: pageIndex + 1, total: pages.length })}
                        data-onboarding-step={pageIndex + 1}
                    >
                        {pages.map((pageId, index) => (
                            <span
                                key={pageId}
                                className="h-1.5 rounded-full transition-all duration-300"
                                style={{
                                    width: index === pageIndex ? 18 : 6,
                                    backgroundColor: index === pageIndex ? accentColor : (isDaylight ? '#18181b' : '#fafafa'),
                                    opacity: index === pageIndex ? 1 : 0.2,
                                }}
                            />
                        ))}
                    </div>
                ) : <span />}

                <div className="flex items-center gap-2">
                    {pageIndex > 0 && (
                        <button
                            type="button"
                            data-testid="playback-entry-view-prompt-back"
                            onClick={() => goTo(pageIndex - 1)}
                            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${secondaryBtnClass}`}
                        >
                            {t('playbackEntryView.back')}
                        </button>
                    )}
                    {isLastPage ? (
                        <button
                            type="button"
                            data-testid="playback-entry-view-prompt-confirm"
                            onClick={onClose}
                            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${btnClass}`}
                        >
                            {t('playbackEntryView.confirm')}
                        </button>
                    ) : (
                        <button
                            type="button"
                            data-testid="playback-entry-view-prompt-next"
                            onClick={() => goTo(pageIndex + 1)}
                            className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${btnClass}`}
                        >
                            {t('playbackEntryView.next')}
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
};
