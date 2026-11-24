import type { ModRuntimeInfo, ModSetEnabledResult } from '../types';
import { switchSourceState } from '../runtime/sourceSwitches';
import { useModsStore } from '../useModsStore';

// src/mods/market/modSwitch.ts
// What "on" means for a mod in the mods window, and the switch behind its button. A source mod has two switches:
// its own (the Mods page) and each of its sources' (Settings → Sources, plan §5.3). It runs only when both let it,
// so the mods window shows it on only then, and its button turns its sources on and off the way Settings → Sources
// does, instead of flipping a mod switch that page does not show.

type ToggleMod = (modId: string, enabled: boolean) => Promise<ModSetEnabledResult>;

/**
 * Turns a mod on or off from the mods window. A mod without sources flips its own switch. A source mod turned on
 * gets its own switch on first (the main process asks the user) and then, when every source of it was off, all of
 * them on; turned off, its sources are switched off and its own switch stays as it is.
 */
export const switchModOn = async (mod: ModRuntimeInfo, on: boolean, toggleMod: ToggleMod): Promise<{ ok: boolean; error?: string }> => {
    const sources = mod.sources ?? [];
    if (sources.length === 0) return toggleMod(mod.id, on);
    if (on && !mod.enabled) {
        const answer = await toggleMod(mod.id, true);
        if (!answer.ok) return answer;
    }
    const wanted = on ? 'enabled' : 'disabled';
    // Turning on touches the sources only when all of them were off: one already on (or used for matching) is the user's choice.
    const targets = on
        ? (mod.sourcesOff ? sources : [])
        : sources.filter((source) => source.state !== 'disabled');
    let failure: { ok: false; error?: string } | null = null;
    for (const source of targets) {
        const answer = await switchSourceState(source.id, wanted);
        if (!answer.ok && !failure) failure = { ok: false, error: answer.error };
    }
    if (targets.length > 0) await useModsStore.getState().refresh();
    return failure ?? { ok: true };
};
