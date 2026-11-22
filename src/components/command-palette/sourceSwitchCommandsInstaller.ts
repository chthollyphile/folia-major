import i18n from '../../i18n/config';
import { providerDisplayName } from '../../i18n/providerName';
import { getSourceStates, subscribeSourceStates } from '../../mods/ipc';
import { switchSourceState } from '../../mods/runtime/sourceSwitches';
import type { ModSourceState, ModSourceStateRow } from '../../mods/types';
import { useModsStore } from '../../mods/useModsStore';
import { omni } from '../../services/onlineMusic/omni';
import { subscribeSourceDeclarations } from '../../services/onlineMusic/sourceDeclarations';
import { canSourceMatchOnly } from '../../services/onlineMusic/sourceStates';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { buildSourceRows, manifestSourceName, SILENT_SOURCE_ERRORS, sourceErrorReason, type SourceRowModel } from '../modal/settings/pages/sources/sourcesModel';
import { setSourceSwitchCommands } from './commandRegistry';
import { buildSourceSwitchCommands, type SourceSwitchTarget } from './commands/sourceSwitchCommands';

// src/components/command-palette/sourceSwitchCommandsInstaller.ts
// Keeps the commands that switch one source (commands/sourceSwitchCommands) in the command list, following the main
// process's source states the way "Settings → Sources" does: the same rows (sourcesModel buildSourceRows), the same
// names, the same switch (sourceSwitches.switchSourceState). Installed once from bootstrap in the main window; on the
// web there are no source states, so no commands.

let installed = false;
let sources: readonly ModSourceStateRow[] = [];

const STATE_TEXT_KEYS: Record<ModSourceState, string> = {
    enabled: 'sourcesSettings.stateEnabled',
    matching: 'sourcesSettings.stateMatching',
    disabled: 'sourcesSettings.stateDisabled',
};

// A source mod by its manifest's name in every state, as "Settings → Sources" names it; a source the host registers
// by the name the switcher uses.
const nameOf = (row: SourceRowModel) => (): string => {
    if (row.manifestName) return manifestSourceName(row.manifestName, i18n.language, row.sourceId);
    const naming = omni.getProviderNaming(row.sourceId);
    return naming ? providerDisplayName(i18n.t.bind(i18n), naming, row.sourceId) : row.sourceId;
};

// One switch per source at a time, as "Settings → Sources" keeps it (its withPending): a second command for a source
// whose switch is still under way is ignored rather than raced against it.
const switching = new Set<string>();

const failed = (target: SourceSwitchTarget, error: string | undefined) => {
    if (error && SILENT_SOURCE_ERRORS.has(error)) return;
    const reason = sourceErrorReason(error, key => i18n.t(key), key => i18n.exists(key));
    setStatusMessage({ type: 'error', text: i18n.t('sourcesSettings.switchFailed', { name: target.name(), reason }) });
};

/** Switches `target` to `state` (exported for the tests). Never rejects: a throw is shown as a failed switch. */
export const runSourceSwitch = async (target: SourceSwitchTarget, state: ModSourceState): Promise<void> => {
    if (switching.has(target.sourceId)) return;
    switching.add(target.sourceId);
    try {
        const answer = await switchSourceState(target.sourceId, state);
        if (answer.ok) {
            if (answer.sources) applySources(answer.sources);
            setStatusMessage({
                type: 'success',
                text: i18n.t('commandPalette.sourceSwitched', { source: target.name(), state: i18n.t(STATE_TEXT_KEYS[state]) }),
            });
            return;
        }
        failed(target, answer.error);
    } catch (error: unknown) {
        console.warn('[Sources] switching a source from the command palette failed', { sourceId: target.sourceId, state, error });
        failed(target, undefined);
    } finally {
        switching.delete(target.sourceId);
    }
};

/** The commands for the source states known now (exported for the tests). */
export const buildInstalledSourceSwitchCommands = () => {
    const rows = buildSourceRows(sources, useModsStore.getState().mods, {
        canMatchOnly: canSourceMatchOnly,
        sort: ids => omni.sortSourceIds(ids),
    });
    const targets: SourceSwitchTarget[] = rows.map(row => ({
        sourceId: row.sourceId,
        state: row.state,
        threeStates: row.threeStates,
        name: nameOf(row),
    }));
    return buildSourceSwitchCommands(targets, runSourceSwitch);
};

const install = () => setSourceSwitchCommands(buildInstalledSourceSwitchCommands());

let modsAsked = false;

const applySources = (next: readonly ModSourceStateRow[]) => {
    sources = next;
    install();
    // A source mod is named by its manifest, which the main process's rows carry; the mod list is read once when a row
    // came without it and nothing has read the list yet (the Mods page and "Settings → Sources" keep it fresh after that).
    if (!modsAsked && useModsStore.getState().mods.length === 0 && next.some(row => row.modId !== null && !row.name)) {
        modsAsked = true;
        void useModsStore.getState().refresh();
    }
};

/** Reads the source states and keeps the commands following them, the registry and the mod list. */
export const installSourceSwitchCommands = (): void => {
    if (installed) return;
    installed = true;
    void getSourceStates().then(answer => applySources(answer.sources));
    subscribeSourceStates(payload => applySources(Array.isArray(payload.sources) ? payload.sources : []));
    // Names and the order follow the registry; what may be used only for matching follows the declarations; the
    // names of sources switched off follow their mods' manifests.
    omni.subscribeProviders(install);
    subscribeSourceDeclarations(install);
    useModsStore.subscribe((state, previous) => {
        if (state.mods !== previous.mods) install();
    });
};
