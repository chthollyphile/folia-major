import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
    assignSourceClaim,
    confirmModOverride,
    getSourceStates,
    getSourceStorageUsage,
    subscribeSourceStates,
} from '../../../../../mods/ipc';
import { clearSourceData, switchSourceState } from '../../../../../mods/runtime/sourceSwitches';
import type { ModSourceState, ModSourceStatesPayload, ModSourceUsageResult } from '../../../../../mods/types';
import { useModsStore } from '../../../../../mods/useModsStore';
import { omni } from '../../../../../services/onlineMusic/omni';
import { subscribeSourceDeclarations } from '../../../../../services/onlineMusic/sourceDeclarations';
import { canSourceMatchOnly, knowsWhetherSourceMatchesOnly } from '../../../../../services/onlineMusic/sourceStates';
import { setStatusMessage } from '../../../../../stores/useStatusMessageStore';
import { buildSourceNotices, buildSourceRows, SILENT_SOURCE_ERRORS, sourceErrorReason, type SourceNoticeAction } from './sourcesModel';

// src/components/modal/settings/pages/sources/useSourcesSettings.ts
// The state of "Settings → Sources": the main process's source states (read on open, then as it pushes them), the
// mod list it reads the notes from, each source's disk use, and the actions of the page. Every action goes
// through the runtime's own path (sourceSwitches.ts, the mods IPC); the main process asks the user before "clear
// data", a takeover or an override changes anything.

const EMPTY: ModSourceStatesPayload = { states: {}, sources: [] };

// The registry's version, followed by useSyncExternalStore (module-level, so it does not subscribe anew each render).
const subscribeRegistry = (listener: () => void) => omni.subscribeProviders(listener);
const readRegistryVersion = () => omni.getProviderRegistryVersion();

export const useSourcesSettings = () => {
    const { t, i18n } = useTranslation();
    const [payload, setPayload] = useState<ModSourceStatesPayload>(EMPTY);
    const [ready, setReady] = useState(false);
    const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
    // By source id; a source not asked yet, or not measured, has no entry.
    const [usage, setUsage] = useState<Readonly<Record<string, ModSourceUsageResult>>>({});
    const mods = useModsStore(state => state.mods);
    // Names, marks and what may be used only for matching follow the registry (a source mod starting or stopping).
    const registryVersion = useSyncExternalStore(subscribeRegistry, readRegistryVersion);
    // A source mod declares its capabilities after it registers: whether it may be used only for matching follows.
    const [declarationsVersion, setDeclarationsVersion] = useState(0);
    useEffect(() => subscribeSourceDeclarations(() => setDeclarationsVersion(version => version + 1)), []);

    const refreshStates = useCallback(async () => {
        try {
            const next = await getSourceStates();
            setPayload({ states: next.states, sources: next.sources });
        } finally {
            // Drawn even when the read failed: the install groups wait for it (SourcesPage).
            setReady(true);
        }
    }, []);

    useEffect(() => {
        void refreshStates();
        void useModsStore.getState().refresh();
        return subscribeSourceStates(next => setPayload({ states: next.states, sources: next.sources }));
    }, [refreshStates]);

    // The two versions are read so the rows follow the registry (the order) and the declarations (what may be
    // used only for matching).
    const rows = useMemo(() => (registryVersion + declarationsVersion >= 0
        ? buildSourceRows(payload.sources, mods, { canMatchOnly: canSourceMatchOnly, knowsMatchOnly: knowsWhetherSourceMatchesOnly, sort: ids => omni.sortSourceIds(ids) })
        : []), [payload.sources, mods, registryVersion, declarationsVersion]);
    const notices = useMemo(() => buildSourceNotices(mods), [mods]);

    // The disk use of each source a mod provides (what its "clear data" removes), read once per source after the rows
    // are drawn (the main process walks its folders) and again after a clear. Asked only where clearing works: the
    // main process measures what it would clear.
    const usageSourceIds = useMemo(() => rows.flatMap(row => (row.clearable && row.modId ? [row.sourceId] : [])), [rows]);
    const usageAsked = useRef(new Set<string>());
    const readUsage = useCallback(async (sourceId: string) => {
        usageAsked.current.add(sourceId);
        const result = await getSourceStorageUsage(sourceId);
        setUsage(current => ({ ...current, [sourceId]: result }));
    }, []);
    useEffect(() => {
        usageSourceIds.filter(sourceId => !usageAsked.current.has(sourceId)).forEach(sourceId => void readUsage(sourceId));
    }, [usageSourceIds, readUsage]);

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
        // Answers the user chose themselves (a cancelled confirmation) are not reported.
        if (error && SILENT_SOURCE_ERRORS.has(error)) return;
        const reason = sourceErrorReason(error, key => t(key), key => i18n.exists(key));
        setStatusMessage({ type: 'error', text: t(key, { name, reason }) });
    }, [t, i18n]);

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
        // Some of it could not be removed: the main process answers 'clear-partial' with what failed.
        if (answer.ok || answer.error === 'clear-partial') {
            setStatusMessage({
                type: answer.ok ? 'success' : 'info',
                text: t(answer.ok ? 'sourcesSettings.clearDone' : 'sourcesSettings.clearPartial', { name }),
            });
        } else {
            reportError(name, answer.error, 'sourcesSettings.clearFailed');
        }
        if (modId) void readUsage(sourceId);
        await refreshStates();
    }), [withPending, reportError, readUsage, refreshStates, t]);

    const runNoticeAction = useCallback((action: SourceNoticeAction, name: string) => withPending(`notice:${action.modId}`, async () => {
        const answer = action.kind === 'assign-claim'
            ? await assignSourceClaim(action.shortId, action.modId)
            : await confirmModOverride(action.modId);
        if (!answer.ok) reportError(name, answer.error, 'sourcesSettings.noticeActionFailed');
        await Promise.all([useModsStore.getState().refresh(), refreshStates()]);
    }), [withPending, reportError, refreshStates]);

    // 「从 zip 安装音源模组」: the main process asks for the file and decides (community mods off: official source mods
    // only); a cancelled picker says nothing. The loader's error codes are the mods page's (mods.errors.*).
    const installZip = useCallback(() => withPending('install-zip', async () => {
        const result = await useModsStore.getState().installModFromPickedZip();
        if (result.ok) {
            setStatusMessage({ type: 'success', text: t('mods.installSuccess', { id: result.id ?? '' }) });
        } else if (result.error !== 'install-cancelled') {
            const code = result.error ?? 'install-failed';
            setStatusMessage({ type: 'error', text: t(`mods.errors.${code}`, { value: code, defaultValue: code }) });
        }
        await refreshStates();
    }), [withPending, refreshStates, t]);

    return { ready, rows, notices, usage, pending, switchTo, clearData, runNoticeAction, installZip };
};
