import i18n from '../../../i18n/config';
import type { LyricData, StatusMessage } from '../../../types';
import type { LyricLineRule } from '../../../utils/lyrics/lyricLineRules';
import type { LyricStaffAbsorbMode, LyricStaffPolicy } from '../../../utils/lyrics/staffCreditsPolicy';
import { setStatusMessage as setStatusMsg } from '../../../stores/useStatusMessageStore';
import { setCurrentLineIndex } from '../../../stores/usePlaybackStore';

// src/components/app/home/createLyricFilterPatternSaver.ts

export interface LyricFilterSaveDraft {
    rules: LyricLineRule[];
    staffPolicy: LyricStaffPolicy;
    staffMinDwellSeconds: number;
    staffAbsorbMode: LyricStaffAbsorbMode;
    staffPattern: string;
}

type CreateLyricFilterPatternSaverParams = {
    handleSetLyricLineRules: (rules: LyricLineRule[]) => void;
    handleSetLyricStaffPolicy: (policy: LyricStaffPolicy) => void;
    handleSetLyricStaffMinDwellSeconds: (seconds: number) => void;
    handleSetLyricStaffAbsorbMode: (mode: LyricStaffAbsorbMode) => void;
    handleSetLyricStaffPattern: (pattern: string) => void;
    loadCurrentSongLyricPreview: () => Promise<LyricData | null>;
    setLyrics: (lyrics: LyricData | null) => void;
};

// Creates the Home-facing lyric filter save action without keeping the implementation in App.tsx.
export const createLyricFilterPatternSaver = ({
    handleSetLyricLineRules,
    handleSetLyricStaffPolicy,
    handleSetLyricStaffMinDwellSeconds,
    handleSetLyricStaffAbsorbMode,
    handleSetLyricStaffPattern,
    loadCurrentSongLyricPreview,
    setLyrics,
}: CreateLyricFilterPatternSaverParams) => {
    return async (draft: LyricFilterSaveDraft) => {
        handleSetLyricLineRules(draft.rules);
        handleSetLyricStaffPolicy(draft.staffPolicy);
        handleSetLyricStaffMinDwellSeconds(draft.staffMinDwellSeconds);
        handleSetLyricStaffAbsorbMode(draft.staffAbsorbMode);
        handleSetLyricStaffPattern(draft.staffPattern);

        // Both the line rules and the staff policy are applied where lyrics are shown, never in the
        // lyric cache, so the cache stays: the current song is only laid out again with the new rules.
        const previewLyrics = await loadCurrentSongLyricPreview();
        setLyrics(previewLyrics);
        setCurrentLineIndex(-1);
        setStatusMsg({ type: 'success', text: i18n.t('options.lyricFilterUpdated') });
    };
};
