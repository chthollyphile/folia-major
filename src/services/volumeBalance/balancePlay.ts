import type { ReplayGainInfo, SongResult } from '../../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { toFiniteNumber } from '../../utils/replayGain';
import { rampGain, type AutomixDeckChain } from '../automix/crossfadeGraph';
import { getTrackProfile } from '../automix/profileService';
import { programIsWholeTrack } from '../automix/trackProfile';
import { getPlaybackAnalysisKey } from '../playbackRecovery/representationRegistry';
import type { BalanceMeter } from './balanceMeter';
import { getBalanceRecord, loadBalanceRecord, noteSongStarted, noteWholeReading, typicalGains } from './balanceRecords';
import {
    chooseBalance,
    planBalanceMove,
    SET_RAMP_SEC,
    typicalGainDb,
    type BalanceChoice,
    type BalanceInputs,
} from './balanceRules';

// src/services/volumeBalance/balancePlay.ts
// One song's balance for one play: the gain it starts on, set before it sounds, and the one move a better
// reading may still make (balanceRules.planBalanceMove). Writes only the playing deck's own replayGain node;
// Folia's volume, mute and the system volume are never read or touched.

export interface BalanceApplyInput {
    song: SongResult;
    /** The song's ReplayGain figures as its source gives them. */
    info: ReplayGainInfo | undefined;
    /** The deck playing the song. */
    chain: AutomixDeckChain | null;
    context: AudioContext;
    transitionAudible: boolean;
}

export interface BalanceApplied {
    gainDb: number;
    estimated: boolean;
}

/** The deck's meter at a look. */
interface MeterSeen {
    meter: BalanceMeter;
    plays: number;
    wraps: number;
    heard: number;
}

interface Play {
    songKey: string;
    appliedDb: number | null;
    reading: BalanceChoice | null;
    moved: boolean;
    wholeSeen: boolean;
    /** Seconds this play has sounded. It only grows: a reload of the source goes on from where it was. */
    sec: number;
    /** The start line is written once the play first sounds. */
    started: boolean;
    /** The deck's meter at the last look, to tell this play's time from the song before, and a reload from a loop. */
    seen: MeterSeen | null;
    /** The last look at another deck, which becomes the play's deck once the song is heard there. */
    away: MeterSeen | null;
}

const isWhole = (choice: BalanceChoice) => choice.reading === 'file' || choice.reading === 'played' || choice.reading === 'profile';
const signed = (db: number) => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
const look = (meter: BalanceMeter): MeterSeen => ({ meter, plays: meter.plays(), wraps: meter.wraps(), heard: meter.heardSec() });

const inputsFor = (song: SongResult, info: ReplayGainInfo | undefined, chain: AutomixDeckChain | null): BalanceInputs => {
    const record = getBalanceRecord(song);
    const profile = getTrackProfile(song);
    const program = typeof profile?.programLoudness === 'number' ? profile.programLoudness : null;
    const wholeProfile = program !== null && programIsWholeTrack(profile);
    const source = getPlaybackSourceRef(song);
    const trackGain = toFiniteNumber(info?.trackGain);
    return {
        file: record?.file,
        played: record?.played,
        profile: wholeProfile ? { loudness: program, peak: profile?.peak } : null,
        tag: (source.kind === 'local' || source.kind === 'navidrome') && trackGain !== undefined
            ? { gainDb: trackGain, peak: toFiniteNumber(info?.trackPeak) }
            : null,
        head: wholeProfile ? null : program,
        platformDb: source.kind === 'online' ? trackGain ?? null : null,
        live: chain?.balanceMeter.liveLoudness() ?? null,
        typicalDb: typicalGainDb(typicalGains()),
    };
};

/** What each stand-in would have given the song, against the whole-track gain it has. */
const logStandIns = (song: SongResult, inputs: BalanceInputs, whole: BalanceChoice) => {
    const source = getPlaybackSourceRef(song);
    const standIns: Array<[string, BalanceChoice | null]> = [
        ['tag', inputs.tag ? chooseBalance({ tag: inputs.tag, typicalDb: inputs.typicalDb }) : null],
        [source.kind === 'online' ? source.providerId : 'platform', typeof inputs.platformDb === 'number'
            ? chooseBalance({ platformDb: inputs.platformDb, typicalDb: inputs.typicalDb }) : null],
        ['typical', chooseBalance({ typicalDb: inputs.typicalDb })],
    ];
    console.log(
        `[VolumeBalance] stand-ins for "${song.name}" against its whole-track ${signed(whole.effectiveGainDb)}: `
        + standIns.filter(([, choice]) => choice)
            .map(([label, choice]) => `${label} ${signed(choice!.effectiveGainDb - whole.effectiveGainDb)}`)
            .join(', '),
    );
};

/** The balance of the song playing now. One per audio bridge. */
export const createBalancePlay = () => {
    let play: Play | null = null;
    /** The play before this one, while the song may still come back to its deck (a cancelled blend). */
    let parked: Play | null = null;

    const fresh = (songKey: string): Play => (
        { songKey, appliedDb: null, reading: null, moved: false, wholeSeen: false, sec: 0, started: false, seen: null, away: null }
    );

    /**
     * The play this song is in. The same play through a reload of its source, and when it comes back to the
     * deck still playing it; a new one when its deck came round to the start (a loop), on the gain the loop
     * before left, and for any other song.
     */
    const playFor = (song: SongResult, meter: BalanceMeter | null): Play => {
        const songKey = getPlaybackSongKey(song);
        if (play?.songKey === songKey) {
            const seen = play.seen;
            if (!meter || seen?.meter !== meter || meter.wraps() === seen.wraps) return play;
            return { ...fresh(songKey), appliedDb: play.appliedDb, reading: play.reading, sec: meter.heardSec(), seen: look(meter) };
        }
        const back = parked;
        parked = play;
        if (back?.songKey === songKey && meter && back.seen?.meter === meter && back.seen.plays === meter.plays()) return back;
        noteSongStarted(song);
        void loadBalanceRecord(song);
        return fresh(songKey);
    };

    /**
     * Adds what the deck sounded since the last look. On the first look, what it heard was the song before.
     * True when the look is at another deck than the play's: the play's gain goes there.
     */
    const advance = (current: Play, meter: BalanceMeter): boolean => {
        const now = look(meter);
        const before = current.seen;
        if (before && before.meter !== meter) {
            // The play moves to that deck only once the song is heard on it (it blended into itself, or the
            // graph was built anew). Until then it may be a blend's incoming deck, armed with the next song
            // while the app still names this one: a blend cancelled from there comes back to this deck.
            const away = current.away?.meter === meter ? current.away : null;
            current.away = now;
            if (away && away.plays === now.plays && now.heard > away.heard) {
                current.sec += now.heard - away.heard;
                current.seen = now;
                current.away = null;
            }
            return true;
        }
        current.seen = now;
        current.away = null;
        if (!before) return false;
        // The meter starts again from zero on a new source: a reload of this song goes on from where it was.
        current.sec += before.plays === now.plays ? Math.max(0, now.heard - before.heard) : now.heard;
        return false;
    };

    const setGain = (input: BalanceApplyInput, chain: AutomixDeckChain, choice: BalanceChoice, rampSec: number) => {
        rampGain(input.context, chain.replayGain, 10 ** (choice.effectiveGainDb / 20), rampSec);
        play!.appliedDb = choice.effectiveGainDb;
        play!.reading = choice;
    };

    /** Works out the song's balance again and applies it as the rules allow. Null while no deck can take it. */
    const apply = (input: BalanceApplyInput): BalanceApplied | null => {
        const { song, chain } = input;
        const current = playFor(song, chain?.balanceMeter ?? null);
        play = current;
        const inputs = inputsFor(song, input.info, chain);
        const next = chooseBalance(inputs);
        if (isWhole(next) && !current.wholeSeen) {
            current.wholeSeen = true;
            noteWholeReading(getPlaybackAnalysisKey(song), next.gainDb);
            logStandIns(song, inputs, next);
        }
        if (!chain) return null;

        const otherDeck = advance(current, chain.balanceMeter);
        if (current.appliedDb === null) {
            setGain(input, chain, next, SET_RAMP_SEC);
        } else {
            // The song blended into itself, or the deck's graph was built anew: the play's gain goes with it.
            if (otherDeck) rampGain(input.context, chain.replayGain, 10 ** (current.appliedDb / 20), SET_RAMP_SEC);
            // Not heard on that deck yet: no move is made from there.
            if (current.seen!.meter !== chain.balanceMeter) return { gainDb: current.appliedDb, estimated: current.reading!.estimated };
            // What it sounded on first, before this look may change it.
            if (!current.started && current.sec > 0) {
                current.started = true;
                console.log(`[VolumeBalance] "${song.name}" starts on the ${current.reading!.reading} reading, ${signed(current.appliedDb)}${current.reading!.estimated ? ' (estimated)' : ''}`);
            }
            const move = planBalanceMove({
                playSec: current.sec,
                moved: current.moved,
                currentDb: current.appliedDb,
                nextDb: next.effectiveGainDb,
                blendAudible: input.transitionAudible,
            });
            if (move === 'set') {
                const from = current.appliedDb;
                setGain(input, chain, next, SET_RAMP_SEC);
                console.log(`[VolumeBalance] "${song.name}" set to the ${next.reading} reading as the play starts, ${signed(next.effectiveGainDb)} (was ${signed(from)})`);
            } else if (move && move !== 'hold') {
                const from = current.appliedDb;
                setGain(input, chain, next, move.rampSec);
                current.moved = true;
                console.log(
                    `[VolumeBalance] "${song.name}" moved ${signed(next.effectiveGainDb - from)} at ${current.sec.toFixed(1)}s into the play,`
                    + ` to the ${next.reading} reading (${signed(next.effectiveGainDb)}) over ${move.rampSec}s`,
                );
            } else if (Math.abs(next.effectiveGainDb - current.appliedDb) < 0.05) {
                // The same level, from a better reading.
                current.reading = next;
            }
        }
        return { gainDb: current.appliedDb!, estimated: current.reading!.estimated };
    };

    return {
        apply,
        /** Forgets the play: the next apply starts it again, as when the balance is switched back on. */
        reset: () => {
            play = null;
            parked = null;
        },
    };
};
