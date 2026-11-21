import { create } from 'zustand';
import { getSourceStates, invokeAnswerSourcesOnboarding, invokeSetSourceState } from '../../../mods/ipc';
import { stopPlaybackOfSources } from '../../../mods/runtime/sourceSwitches';
import type { ModSourceState, ModSourceStateRow } from '../../../mods/types';
import { setSourceStates } from '../../../services/onlineMusic/sourceStates';

// src/components/modal/playback-entry-view/sourcesOnboarding.ts
// The start prompt's sources page (Folium 2.0 plan §5.3): a fresh desktop profile is asked once which platforms it
// listens on. Whether the page is owed comes from the main process (folia-mods:source-states, `sourcesOnboarding`),
// which gives a fresh profile 'pending' and an upgraded one nothing; the web build has no main process and is never
// asked. Closing the prompt, however it is closed, hands the whole answer over once: a ticked source is enabled, an
// unticked one the manifest keeps for matching (`keepForMatching`, a built-in copy) is used only for matching, every
// other unticked one is disabled.

/** One built-in source the page lists. */
export interface OnboardingSource {
    sourceId: string;
    /** The name its mod's manifest gives it (one text, or one per language); null for a host platform. */
    name: string | Record<string, string> | null;
    /** Unticked, it stays for matching rather than going off. */
    keepForMatching: boolean;
    /** What its manifest says where it is switched on (`sources[].enableNotice`); null for none. */
    enableNotice: string | Record<string, string> | null;
}

/** The built-in sources among the main process's rows: its own copies and their overrides, never a takeover. */
export const pickOnboardingSources = (rows: readonly ModSourceStateRow[]): OnboardingSource[] => rows
    .filter(row => !row.takeover && (row.tier === 'host' || row.tier === 'builtin' || row.tier === 'override'))
    .map(row => ({ sourceId: row.sourceId, name: row.name ?? null, keepForMatching: row.keepForMatching, enableNotice: row.enableNotice ?? null }));

/** The answer for the main process: every listed source with the state its tick (or its absence) means. */
export const resolveSourcesOnboardingChoices = (
    sources: readonly OnboardingSource[],
    ticked: ReadonlySet<string>,
): Record<string, ModSourceState> => Object.fromEntries(sources.map(source => [
    source.sourceId,
    ticked.has(source.sourceId) ? 'enabled' : source.keepForMatching ? 'matching' : 'disabled',
]));

/** 'unknown' until the main process answered; 'owed' while the page is to be shown and answered. */
export type SourcesOnboardingStatus = 'unknown' | 'owed' | 'none';

interface SourcesOnboardingState {
    status: SourcesOnboardingStatus;
    sources: readonly OnboardingSource[];
    ticked: ReadonlySet<string>;
    toggle: (sourceId: string) => void;
}

export const useSourcesOnboardingStore = create<SourcesOnboardingState>(set => ({
    status: 'unknown',
    sources: [],
    ticked: new Set(),
    toggle: sourceId => set(state => {
        const ticked = new Set(state.ticked);
        if (ticked.has(sourceId)) ticked.delete(sourceId);
        else ticked.add(sourceId);
        return { ticked };
    }),
}));

let loading: Promise<void> | null = null;

/** Asks the main process once whether the page is owed, and which built-in sources it lists. Never rejects. */
export const loadSourcesOnboarding = (): Promise<void> => {
    loading ??= (async () => {
        const answer = await getSourceStates();
        const sources = answer.sourcesOnboarding ? pickOnboardingSources(answer.sources) : [];
        // Owed with nothing to list (an installation that carries no built-in source) has nothing to ask: it is
        // answered with nothing, so the main process stops holding the sources mods back (a third-party one).
        useSourcesOnboardingStore.setState({ status: sources.length > 0 ? 'owed' : 'none', sources });
        if (answer.sourcesOnboarding && sources.length === 0) {
            const answered = await invokeAnswerSourcesOnboarding({});
            if (answered.ok && answered.states) setSourceStates(answered.states);
        }
        if (sources.length > 0) console.info(`[SourcesOnboarding] a fresh profile: the start prompt asks about ${sources.length} sources`);
    })().catch((error: unknown) => {
        console.warn('[SourcesOnboarding] reading whether the sources page is owed failed', error);
        useSourcesOnboardingStore.setState({ status: 'none', sources: [] });
    });
    return loading;
};

/**
 * Hands the page's answer to the main process (the prompt is closing). The page is not asked again in this run
 * whatever the answer; one the main process refused stays owed there, so the next start asks again. Until then the
 * main process runs no source; switching one in "Settings → Sources" counts as the answer and lets them run.
 */
export const submitSourcesOnboarding = async (): Promise<void> => {
    const { status, sources, ticked } = useSourcesOnboardingStore.getState();
    if (status !== 'owed') return;
    useSourcesOnboardingStore.setState({ status: 'none' });
    const choices = resolveSourcesOnboardingChoices(sources, ticked);
    try {
        await stopPlaybackOfSources(Object.keys(choices).filter(sourceId => choices[sourceId] !== 'enabled'));
        let answer = await invokeAnswerSourcesOnboarding(choices);
        // A source switched before the page closed already counted as the answer: the ticks are still what the
        // listener chose last, so each is written as a switch would write it rather than dropped.
        if (!answer.ok && answer.error === 'sources-onboarding-not-owed') {
            for (const [sourceId, state] of Object.entries(choices)) answer = await invokeSetSourceState(sourceId, state);
        }
        if (answer.ok && answer.states) setSourceStates(answer.states);
        console.info(`[SourcesOnboarding] answered with ${ticked.size} of ${sources.length} ticked: ${answer.ok ? 'done' : answer.error ?? 'refused'}`);
    } catch (error) {
        console.warn('[SourcesOnboarding] handing the answer over failed', error);
    }
};
