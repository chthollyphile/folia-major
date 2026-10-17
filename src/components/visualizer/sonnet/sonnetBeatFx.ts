import type { AudioBands } from '../../../types';
import { beatImpact, downbeatImpact } from '../../../stores/motionSignals';
import {
    getBeatFxLastBeat,
    getBeatFxLastDownbeat,
    getBeatFxRotationSign,
    isBeatFxHearing,
    isBeatFxReady,
} from '../../../services/beatFx/beatFxLive';
import type { BeatFxEvent } from '../../../services/beatFx/clock';
import type { SonnetAnimationCue } from './types';

// src/components/visualizer/sonnet/sonnetBeatFx.ts
// Sonnet's share of 智能动感模式 (`SmartBeatSettings`). Pure envelope math plus a per-runtime frame
// reader; each effect follows its own signal:
//   camera punch  <- beatImpact      (zoom + alternating tilt, layered on the shot camera)
//   mono tear     <- downbeatImpact  (shares the transition glitch filter, combined with max)
//   glow flare    <- downbeatImpact  (halo layer alpha)
//   icon pop      <- lyric segment onsets (replaces the band-driven icon breathing)
//   line flash    <- treble band, smoothed, continuous
// Constants are the ones approved on the live picture (a 159 BPM track); the mockup they started from
// is not in the repo. The 轻拍 strength
// (`beatIntensity`) scales the first line, the 重拍 strength (`downbeatIntensity`) the next two and the
// downbeat's share of the zoom - already applied to the two signals by the beat clock (beatFxLive's
// `setBeatFxIntensities`); icon pop and line flash are not beats and follow the switch only.
//
// Until the playing track's beat list is installed (beatFxLive's `isBeatFxReady`) the reader answers
// null and Sonnet draws its original frame - no half-on state while the analysis runs, or on a machine
// it cannot run on. Which modes start the beat clock at all is their registry entry's
// `drawsBeatFx`; another mode adds beat FX with its own reader over the same two signals.
//
// With accents (analysis/beatAccents.ts) the two signals already peak by how hard each beat hits, and
// the last fired beat shapes the punch (`resolveSonnetBeatFxAccent`): a low hit pushes in more, a high
// one tilts more, and the beat before the downbeat (bar position 3) tilts half as much - the camera
// swings back before the bar lands. Without accents the shaping is exactly 1.

export const SONNET_BEAT_FX = {
    /** Mockup used 3% at 118 BPM; at ~160 BPM that read as drift, so beats punch harder and shorter. */
    zoomPercent: 6,
    rotationDeg: 0.6,
    downbeatZoomPercent: 5,
    tear: 0.6,
    tearRate: 24,
    flare: 0.7,
    iconPop: 0.4,
    iconDecayMs: 300,
    /** Line layers sit at this alpha and the treble band lifts them to 1. */
    lineBaseAlpha: 0.78,
} as const;

/** Multipliers on the beat's share of the zoom and on the tilt, from the last fired beat's accent. */
export interface SonnetBeatFxAccent {
    zoom: number;
    tilt: number;
}

export const SONNET_BEAT_FX_NO_ACCENT: Readonly<SonnetBeatFxAccent> = { zoom: 1, tilt: 1 };

/** The punch shaping for the last fired beat; no shaping when it carries no accent. */
export const resolveSonnetBeatFxAccent = (
    event: Pick<BeatFxEvent, 'tone' | 'barPos'> | null,
    out: SonnetBeatFxAccent = { zoom: 1, tilt: 1 },
): SonnetBeatFxAccent => {
    if (!event?.tone) {
        out.zoom = 1;
        out.tilt = 1;
        return out;
    }
    // 1 at an even split; 0.85..1.15 and 0.7..1.3 at the extremes.
    out.zoom = 0.85 + 0.3 * event.tone.low;
    out.tilt = (0.7 + 0.6 * event.tone.high) * (event.barPos === 3 ? 0.5 : 1);
    return out;
};

export interface SonnetBeatFxFrame {
    /** Camera scale multiplier. */
    zoom: number;
    /** Extra camera rotation in radians. */
    rotation: number;
    /** Glitch filter amount from the downbeat envelope (0 when idle). */
    tear: number;
    tearSeed: number;
    /** 0..~0.7 glow flare added to the halo layer. */
    flare: number;
    /** 0..1 smoothed treble level for the line flash. */
    lineLift: number;
}

/** What a beat FX frame touches on a shot, and the alpha its halo was built with. */
export interface SonnetBeatFxShotLayers {
    haloLayer: { alpha: number };
    haloBaseAlpha: number;
    mgGeoLayer?: { alpha: number };
    mgBackgroundLayer?: { alpha: number };
    mgFixedGeoLayer?: { alpha: number };
}

const normalizeLevel = (value: number) => Math.min(1, Math.max(0, value > 1 ? value / 255 : value));

/**
 * Envelope math for one frame, from the two impacts (already scaled by their strengths) and the
 * alternating tilt sign. Writes into `out` when given - the per-frame reader reuses one - and
 * otherwise answers a new frame.
 */
export const resolveSonnetBeatFxFrame = (
    k: number,
    d: number,
    rotationSign: number,
    wallTimeSec: number,
    lineLift: number,
    out: SonnetBeatFxFrame = { zoom: 1, rotation: 0, tear: 0, tearSeed: 0, flare: 0, lineLift: 0 },
    accent: Readonly<SonnetBeatFxAccent> = SONNET_BEAT_FX_NO_ACCENT,
): SonnetBeatFxFrame => {
    out.zoom = 1 + (SONNET_BEAT_FX.zoomPercent / 100) * k * accent.zoom + (SONNET_BEAT_FX.downbeatZoomPercent / 100) * d;
    out.rotation = (SONNET_BEAT_FX.rotationDeg * Math.PI / 180) * k * rotationSign * accent.tilt;
    out.tear = d > 0.02 ? SONNET_BEAT_FX.tear * d : 0;
    out.tearSeed = Math.floor(wallTimeSec * SONNET_BEAT_FX.tearRate) % 997;
    out.flare = SONNET_BEAT_FX.flare * d;
    out.lineLift = lineLift;
    return out;
};

/** Whether this frame is a beat FX frame: 智能动感模式 on and the track's beats installed. */
export const isSonnetBeatFxActive = (smartBeatEnabled: boolean): boolean =>
    smartBeatEnabled && isBeatFxReady();

/**
 * Creates the per-runtime frame reader. Returns null every frame the FX are not active, so callers
 * keep their original code path. Holds the treble smoothing state and the one frame it fills.
 */
export const createSonnetBeatFxReader = () => {
    let smoothedTreble = 0;
    const frame: SonnetBeatFxFrame = { zoom: 1, rotation: 0, tear: 0, tearSeed: 0, flare: 0, lineLift: 0 };
    const accent: SonnetBeatFxAccent = { zoom: 1, tilt: 1 };
    return (audioBands: AudioBands | undefined, smartBeatEnabled: boolean): SonnetBeatFxFrame | null => {
        if (!isSonnetBeatFxActive(smartBeatEnabled)) {
            smoothedTreble = 0;
            return null;
        }
        // At rest while nothing is heard: paused, the bridge writes an idle breath into the bands,
        // which would otherwise pulse the lines in time with nothing.
        const treble = isBeatFxHearing() ? normalizeLevel(audioBands?.treble?.get() ?? 0) : 0;
        // Ignore the idle breathing floor, then ease: quick attack, slow release, no discrete trigger.
        const target = Math.min(1, Math.max(0, (treble - 0.04) / 0.35));
        smoothedTreble += (target - smoothedTreble) * (target > smoothedTreble ? 0.25 : 0.08);
        // The punch on screen is the latest one, a downbeat or a plain beat.
        const beat = getBeatFxLastBeat();
        const downbeat = getBeatFxLastDownbeat();
        const last = beat && (!downbeat || beat.t > downbeat.t) ? beat : downbeat;
        return resolveSonnetBeatFxFrame(
            beatImpact.get(),
            downbeatImpact.get(),
            getBeatFxRotationSign(),
            performance.now() / 1000,
            smoothedTreble,
            frame,
            resolveSonnetBeatFxAccent(last, accent),
        );
    };
};

/** Alpha of the MG line layers for a given treble lift. */
export const resolveSonnetLineFlashAlpha = (lineLift: number) =>
    SONNET_BEAT_FX.lineBaseAlpha + (1 - SONNET_BEAT_FX.lineBaseAlpha) * Math.min(1, Math.max(0, lineLift));

/**
 * Icon pop driven by the lyric segment onsets of the shot: a 0..1 envelope that restarts on every
 * cue and decays over ~300 ms. Stateless (latest cue at or before `time`), so seeking is safe. A scan
 * rather than a search: a shot holds a few dozen cues at most, and nothing promises their order.
 */
export const resolveSonnetIconOnsetPop = (time: number, cues: readonly SonnetAnimationCue[]): number => {
    let lastAt = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < cues.length; index += 1) {
        const at = cues[index].at;
        if (at <= time && at > lastAt) lastAt = at;
    }
    const elapsedMs = (time - lastAt) * 1000;
    return elapsedMs >= 0 && Number.isFinite(elapsedMs)
        ? Math.exp(-elapsedMs / SONNET_BEAT_FX.iconDecayMs * 2.3)
        : 0;
};

/** Icon scale for an onset pop envelope `k`. */
export const resolveSonnetIconPopScale = (k: number) => 1 + SONNET_BEAT_FX.iconPop * k * (1.15 - 0.15 * k);

/** Writes one beat FX frame onto a shot: line flash on the MG layers, downbeat flare on the halo. */
export const applySonnetBeatFxLayers = (view: SonnetBeatFxShotLayers, frame: SonnetBeatFxFrame) => {
    const lineAlpha = resolveSonnetLineFlashAlpha(frame.lineLift);
    if (view.mgGeoLayer) view.mgGeoLayer.alpha = lineAlpha;
    if (view.mgBackgroundLayer) view.mgBackgroundLayer.alpha = lineAlpha;
    if (view.mgFixedGeoLayer) view.mgFixedGeoLayer.alpha = lineAlpha;
    const base = view.haloBaseAlpha;
    view.haloLayer.alpha = Math.min(1, base + (1 - base) * Math.min(1, frame.flare));
};

/**
 * Puts back what a beat FX frame changed on a shot, for the frames between "active" and "not": the
 * MG line layers are built at full alpha, and the halo at `haloBaseAlpha`.
 */
export const restoreSonnetBeatFxLayers = (view: SonnetBeatFxShotLayers) => {
    if (view.mgGeoLayer) view.mgGeoLayer.alpha = 1;
    if (view.mgBackgroundLayer) view.mgBackgroundLayer.alpha = 1;
    if (view.mgFixedGeoLayer) view.mgFixedGeoLayer.alpha = 1;
    view.haloLayer.alpha = view.haloBaseAlpha;
};
