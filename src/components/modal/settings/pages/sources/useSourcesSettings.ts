import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
    assignSourceClaim,
    confirmModOverride,
    getModStorageUsage,
    getSourceStates,
    subscribeSourceStates,
} from '../../../../../mods/ipc';
import { clearSourceData, switchSourceState } from '../../../../../mods/runtime/sourceSwitches';
import type { ModSourceState, ModSourceStatesPayload, ModStorageUsageResult } from '../../../../../mods/types';
import { useModsStore } from '../../../../../mods/useModsStore';
import { omni } from '../../../../../services/onlineMusic/omni';
import { canSourceMatchOnly } from '../../../../../services/onlineMusic/sourceStates';
import { setStatusMessage } from '../../../../../stores/useStatusMessageStore';
import { buildSourceNotices, buildSourceRows, type SourceNoticeAction } from './sourcesModel';

// src/components/modal/settings/pages/sources/useSourcesSettings.ts
// The state of "Settings → Sources": the main process's source states (read on open, then as it pushes them), the
// mod list it reads the notes from, each source mod's disk use, and the actions of the page. Every action goes
// through the runtime's own path (sourceSwitches.ts, the mods IPC); the main process asks the user before "clear
// data", a takeover or an override changes anything.

const EMPTY: ModSourceStatesPayload = { states: {}, sources: [] };

// Answers the user chose themselves (a cancelled confirmation) are not reported.
const SILENT_ERRORS = new Set(['clear-declined', 'enable-declined']);

export const useSourcesSettings = () => {
    const { t } = useTranslation();
    const [payload, setPayload] = useState<ModSourceStatesPayload>(EMPTY);
    const [ready, setReady] = useState(false);
    const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
    const [usage, setUsage] = useState<Readonly<Record<string, ModStorageUsageResult>>>({});
    const mods = useModsStore(state => state.mods);
    // Names, marks and what may be used only for matching follow the registry (a source mod starting or stopping).
    const registryVersion = useSyncExternalStore(
        (listener: () => void) => omni.subscribeProviders(listener),
        () => omni.getProviderRegistryVersion(),
    );

    const refreshStates = useCallback(async () => {
        const next = await getSourceStates();
        setPayload({ states: next.states, sources: next.sources });
        setReady(true);
    }, []);

    useEffect(() => {
        void refreshStates();
        void useModsStore.getState().refresh();
        return subscribeSourceStates(next => setPayload({ states: next.states, sources: next.sources }));
    }, [refreshStates]);

    // registryVersion is read so the rows follow the registry: the order and what may be used only for matching.
    const rows = useMemo(() => (registryVersion >= 0
        ? buildSourceRows(payload.sources, mods, { canMatchOnly: canSourceMatchOnly, sort: ids => omni.sortSourceIds(ids) })
        : []), [payload.sources, mods, registryVersion]);
    const notices = useMemo(() => buildSourceNotices(mods), [mods]);

    // The disk use of each source mod, read once per mod (counting walks its folders) and again after a clear.
    const usageModIds = useMemo(() => [...new Set(rows.flatMap(row => (row.clearable && row.modId ? [row.modId] : [])))], [rows]);
    const usageAsked = useRef(new Set<string>());
    const readUsage = useCallback(async (modId: string) => {
        usageAsked.current.add(modId);
        const result = await getModStorageUsage(modId);
        setUsage(current => ({ ...current, [modId]: result }));
    }, []);
    useEffect(() => {
        usageModIds.filter(modId => !usageAsked.current.has(modId)).forEach(modId => void readUsage(modId));
    }, [usageModIds, readUsage]);

    const withPending = useCallback(async (key: string, run: () => Promise<void>) => {
        setPending(current => new Set(current).add(key));
        try {
            await run();
        } finally {
            setPending((current) => {
                const next = new Set(current);
                next.delete(key);
                return next;
            });
        }
    }, []);

    const reportError = useCallback((name: string, error: string | undefined, key: string) => {
        if (error && SILENT_ERRORS.has(error)) return;
        const reason = t(`sourcesSettings.errors.${error ?? 'unknown'}`, { defaultValue: error ?? '' });
        setStatusMessage({ type: 'error', text: t(key, { name, reason }) });
    }, [t]);

    const switchTo = useCallback((sourceId: string, name: string, state: ModSourceState) => withPending(sourceId, async () => {
        const answer = await switchSourceState(sourceId, state);
        if (answer.ok && answer.sources) {
            setPayload({ states: answer.states ?? {}, sources: answer.sources });
        } else if (!answer.ok) {
            reportError(name, answer.error, 'sourcesSettings.switchFailed');
        }
        void useModsStore.getState().refresh();
    }), [withPending, reportError]);

    const clearData = useCallback((sourceId: string, name: string, modId: string | null) => withPending(sourceId, async () => {
        const answer = await clearSourceData(sourceId);
        if (answer.ok) {
            setStatusMessage({
                type: answer.failed?.length ? 'info' : 'success',
                text: t(answer.failed?.length ? 'sourcesSettings.clearPartial' : 'sourcesSettings.clearDone', { name }),
            });
        } else {
            reportError(name, answer.error, 'sourcesSettings.clearFailed');
        }
        if (modId) void readUsage(modId);
        await refreshStates();
    }), [withPending, reportError, readUsage, refreshStates, t]);

    const runNoticeAction = useCallback((action: SourceNoticeAction, name: string) => withPending(`notice:${action.modId}`, async () => {
        const answer = action.kind === 'assign-claim'
            ? await assignSourceClaim(action.shortId, action.modId)
            : await confirmModOverride(action.modId);
        if (!answer.ok) reportError(name, answer.error, 'sourcesSettings.noticeActionFailed');
        await Promise.all([useModsStore.getState().refresh(), refreshStates()]);
    }), [withPending, reportError, refreshStates]);

    return { ready, rows, notices, usage, pending, switchTo, clearData, runNoticeAction };
};
