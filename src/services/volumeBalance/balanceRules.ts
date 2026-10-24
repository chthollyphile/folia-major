import { SILENCE_DB } from '../automix/signalAnalysis';

// src/services/volumeBalance/balanceRules.ts
// The decisions of 智能平衡 (ReplayGain mode 'auto'), with no I/O: which reading of a song's loudness to
// trust, what gain it gives, the typical guess, when a better reading may still move a playing song, and
// whether a play heard the song whole.

/** Where the balance brings a song, in LUFS: the level the big streaming services play at. */
export const VOLUME_BALANCE_TARGET_DB = -14;
/** The most a quiet song is lifted by: past it, a near-silent track's noise would be lifted too. */
export const VOLUME_BALANCE_MAX_BOOST_DB = 6;
/**
 * How high a lifted song's loudest sample may reach, in dBFS. The file's peak is read at the analysis
 * rate, which misses a little of the file's own, so this keeps 1.5 dB.
 */
export const VOLUME_BALANCE_PEAK_CEILING_DB = -1.5;
/** ReplayGain 2 tags aim at -18 LUFS, 4 dB under the balance's target. */
export const TAG_TARGET_OFFSET_DB = 4;
/** Seconds of sound the deck's own meter must have heard before its reading counts. */
export const LIVE_MIN_SOUND_SEC = 10;
/** How many whole-track readings the typical guess is taken over. */
export const TYPICAL_SIZE = 20;
/** The typical guess before any song has been read whole. */
export const TYPICAL_FALLBACK_DB = -5;

/** Within this long into a play, a better reading eases in. */
export const EARLY_MOVE_SEC = 10;
export const EARLY_RAMP_SEC = 2;
/** Up to this long into a play, only a clear turn-down is still made. */
export const LATE_MOVE_SEC = 30;
export const LATE_RAMP_SEC = 5;
export const LATE_MIN_CUT_DB = 3;
/** How a gain set before the song sounds is put in: short enough to land before the first note. */
export const SET_RAMP_SEC = 0.1;
/** Smaller differences are not a move. */
const SAME_GAIN_DB = 0.05;

/** A song's loudness (BS.1770, LUFS) and its loudest sample, linear. */
export interface MeasuredLoudness {
    loudness: number;
    peak?: number | null;
}

/** False for SILENCE_DB, where no block passed BS.1770's -70 LUFS gate: such a reading tells no loudness. */
export const isAudible = (measured: MeasuredLoudness): boolean => measured.loudness > SILENCE_DB;

/** Most trusted first. 'file', 'played' and 'profile' are whole-track readings. */
export type BalanceReading = 'file' | 'played' | 'profile' | 'tag' | 'head' | 'platform' | 'live' | 'typical';

export interface BalanceInputs {
    /** The file decoded and measured whole. */
    file?: MeasuredLoudness | null;
    /** Learned from a whole play on a deck. */
    played?: MeasuredLoudness | null;
    /** A whole-track automix profile from before the balance kept its own records. */
    profile?: MeasuredLoudness | null;
    /** A local or library file's ReplayGain track gain (dB, as tagged) and peak (linear). */
    tag?: { gainDb: number; peak?: number | null } | null;
    /** BS.1770 loudness of the head only. */
    head?: number | null;
    /** An online platform's own gain for the song, already relative to the target. */
    platformDb?: number | null;
    /** The playing deck's own meter, once it has heard LIVE_MIN_SOUND_SEC. */
    live?: number | null;
    /** From typicalGainDb. */
    typicalDb: number;
}

export interface BalanceChoice {
    reading: BalanceReading;
    /** What the reading asks for. */
    gainDb: number;
    /** What is applied: lifted only within the caps, or turned down only. */
    effectiveGainDb: number;
    /** True for a reading that only stands in until the song is read whole. */
    estimated: boolean;
}

/** A gain that may lift: no more than the cap, and only while the peak stays under the ceiling. */
export const liftWithinPeak = (gainDb: number, peak?: number | null): number => {
    if (gainDb <= 0) return gainDb;
    if (!(typeof peak === 'number' && peak > 0)) return 0;
    const headroomDb = VOLUME_BALANCE_PEAK_CEILING_DB - 20 * Math.log10(peak);
    return Math.min(gainDb, VOLUME_BALANCE_MAX_BOOST_DB, Math.max(0, headroomDb));
};

const choice = (reading: BalanceReading, gainDb: number, effectiveGainDb: number, estimated: boolean): BalanceChoice => (
    { reading, gainDb, effectiveGainDb, estimated }
);

/** The most trusted reading there is, and the gain it gives. Every estimate only turns a song down. */
export const chooseBalance = (inputs: BalanceInputs): BalanceChoice => {
    const whole: Array<[BalanceReading, MeasuredLoudness | null | undefined]> = [
        ['file', inputs.file], ['played', inputs.played], ['profile', inputs.profile],
    ];
    for (const [reading, measured] of whole) {
        if (!measured || !isAudible(measured)) continue;
        const gainDb = VOLUME_BALANCE_TARGET_DB - measured.loudness;
        return choice(reading, gainDb, liftWithinPeak(gainDb, measured.peak), false);
    }
    if (inputs.tag) {
        const gainDb = inputs.tag.gainDb + TAG_TARGET_OFFSET_DB;
        return choice('tag', gainDb, liftWithinPeak(gainDb, inputs.tag.peak), false);
    }
    const estimates: Array<[BalanceReading, number | null | undefined]> = [
        ['head', typeof inputs.head === 'number' ? VOLUME_BALANCE_TARGET_DB - inputs.head : null],
        ['platform', inputs.platformDb],
        ['live', typeof inputs.live === 'number' ? VOLUME_BALANCE_TARGET_DB - inputs.live : null],
        ['typical', inputs.typicalDb],
    ];
    for (const [reading, gainDb] of estimates) {
        if (typeof gainDb === 'number' && Number.isFinite(gainDb)) return choice(reading, gainDb, Math.min(0, gainDb), true);
    }
    return choice('typical', TYPICAL_FALLBACK_DB, TYPICAL_FALLBACK_DB, true);
};

/** The median gain of the last TYPICAL_SIZE whole-track readings, never a lift; TYPICAL_FALLBACK_DB before any. */
export const typicalGainDb = (gains: readonly number[]): number => {
    const recent = gains.slice(-TYPICAL_SIZE).filter(Number.isFinite).sort((a, b) => a - b);
    if (!recent.length) return TYPICAL_FALLBACK_DB;
    const middle = Math.floor(recent.length / 2);
    const median = recent.length % 2 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2;
    return Math.min(0, median);
};

export interface MoveQuestion {
    /** Seconds this play has sounded; 0 before it starts. */
    playSec: number;
    /** A move was already made in this play. */
    moved: boolean;
    currentDb: number;
    nextDb: number;
    /** An automix blend can be heard. */
    blendAudible: boolean;
}

/**
 * What a better reading may do to a song already set: 'set' before it sounds (not a move), ease in over
 * `rampSec` (the one move of the play), 'hold' until the blend ends, or null for nothing (the next play
 * uses it).
 */
export const planBalanceMove = (question: MoveQuestion): 'set' | 'hold' | { rampSec: number } | null => {
    const { playSec, moved, currentDb, nextDb, blendAudible } = question;
    if (Math.abs(nextDb - currentDb) < SAME_GAIN_DB) return null;
    if (playSec <= 0) return 'set';
    if (moved) return null;
    const rampSec = playSec < EARLY_MOVE_SEC
        ? EARLY_RAMP_SEC
        : playSec < LATE_MOVE_SEC && nextDb <= currentDb - LATE_MIN_CUT_DB ? LATE_RAMP_SEC : null;
    if (rampSec === null) return null;
    return blendAudible ? 'hold' : { rampSec };
};

/** What stopped a play from counting as a whole one: a seek after it sounded, or audio the meter missed. */
export type BrokenPlay = 'seek' | 'gap';

/** One play as a deck's meter heard it (balanceMeter). */
export interface MeteredPlay extends MeasuredLoudness {
    peak: number;
    /** Media seconds it went through: a stall or a pause adds none, a bent tempo what the song moved. */
    heardSec: number;
    /** The media position it first sounded from, and the last one it reached. */
    fromSec: number;
    toSec: number;
    broken: BrokenPlay | null;
}

/** As recordPlayedTail's: a blended song is stopped a little before its media runs out. */
export const PLAY_MISS_TOLERANCE_SEC = 2;
/**
 * How far past its leading silence a whole play may have started: a blend enters the song past its silence
 * and walks the entry up to a bar on, to land on a bar line.
 */
export const PLAY_LATE_START_SEC = 2;

export interface WholePlayQuestion {
    /** The media's length in seconds. */
    duration: number;
    /** The song's leading silence (TrackProfile.leadIn), when known. */
    leadInSec?: number | null;
    /** Why what the deck played is not the song (wholeSongCheck), or null. */
    clip?: string | null;
}

/**
 * Why a play does not tell the song's loudness, or null when it heard the song whole: no seek or missed
 * audio after it sounded, the song and not a clip, from its start (the leading silence and PLAY_LATE_START_SEC
 * may be skipped, which gated loudness ignores or barely feels) to within PLAY_MISS_TOLERANCE_SEC of its end,
 * and not silence.
 */
export const whyNotWholePlay = (play: MeteredPlay, question: WholePlayQuestion): string | null => {
    const { duration, leadInSec, clip } = question;
    if (play.broken) return play.broken;
    if (clip) return `not the whole song (${clip})`;
    if (!(Number.isFinite(duration) && duration > 0)) return 'length unknown';
    if (play.fromSec > Math.max(0, leadInSec ?? 0) + PLAY_LATE_START_SEC) return `started at ${play.fromSec.toFixed(1)}s`;
    if (duration - play.toSec > PLAY_MISS_TOLERANCE_SEC) return `stopped at ${play.toSec.toFixed(1)}s`;
    if (play.loudness <= SILENCE_DB) return 'silence';
    return null;
};
