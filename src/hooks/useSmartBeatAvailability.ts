import { useEffect, useState } from 'react';
import { probeBeatThisGpu } from '../services/analysis/beatThisGpu';
import type { SmartBeatMode } from '../types';

// src/hooks/useSmartBeatAvailability.ts
// Whether beat FX (智能动感模式, in every mode and background that draws them) can do anything on this
// install, for a setting to say so next to its switch. The switch itself stays usable either way - it
// is a preference - but a switch that is on and silently inert is the failure this is here to prevent.
//
// The model (Beat This! final0, shared with automix) ships with the desktop app, so there is no "not downloaded" state: what can be
// missing is the desktop bridge (the web build) or a GPU that hands out an adapter. Under `cached`
// the GPU does not matter - nothing runs, and a list automix stored from a CPU run plays as well - so
// only the bridge is asked, the analyses being the desktop app's.

export type SmartBeatAvailability = 'ready' | 'desktopOnly' | 'noGpu';

const hasBeatThisBridge = () => typeof window !== 'undefined' && typeof window.electron?.getBeatThisGpuWeights === 'function';

/**
 * The GPU is probed only under `on`. Off, nothing is probed (no adapter request) and the answer is
 * 'ready', which a caller shows nothing for.
 */
export function useSmartBeatAvailability(mode: SmartBeatMode): SmartBeatAvailability {
    // Optimistic until the probe answers: a hint flashing "no GPU" on every open would be worse.
    const [gpu, setGpu] = useState(true);
    const probe = mode === 'on';

    useEffect(() => {
        if (!probe) return;
        let cancelled = false;
        void probeBeatThisGpu().then((found) => {
            if (!cancelled) setGpu(found);
        });
        return () => {
            cancelled = true;
        };
    }, [probe]);

    if (mode === 'off') return 'ready';
    if (!hasBeatThisBridge()) return 'desktopOnly';
    return gpu || !probe ? 'ready' : 'noGpu';
}
