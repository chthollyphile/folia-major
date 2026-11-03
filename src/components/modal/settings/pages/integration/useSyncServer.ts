import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSyncLibraryZipBlob, readSyncLibraryZipFile } from '../../../../../services/sync/syncArchive';
import { getSyncConfig, getSyncStatus, saveSyncConfig, setSyncStatus, subscribeSyncConfig, subscribeSyncStatus } from '../../../../../services/sync/syncConfig';
import { exportSyncLibraryBundle, importSyncLibraryBundle, isSyncLibraryExportBundle, syncNow, testSyncProviderConnection } from '../../../../../services/sync/syncCoordinator';
import { SYNC_PROVIDER, type SyncLibraryExportBundle, type SyncProviderConfig } from '../../../../../services/sync/syncTypes';
import { createSafeObjectUrl } from '../../../../../utils/blobGuards';
import { formatLocalDateTimeStamp } from '../../../../../utils/downloadFileName';

// src/components/modal/settings/pages/integration/useSyncServer.ts
// The sync server form of the 连接与集成 page. The switch, the address and the token are a draft
// until they are saved (the save button, a test that succeeds, or either sync). Besides the draft
// it holds what is running, the line that says how the last action went, and the actions: save,
// test, sync the AI themes, sync the visual settings, and write or read the sync library as a file.

type SyncAction = 'idle' | 'testing' | 'syncing' | 'syncingSettings' | 'exporting' | 'importing';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useSyncServer = () => {
    const { t } = useTranslation();
    const [saved, setSaved] = useState<SyncProviderConfig>(getSyncConfig);
    const [draft, setDraft] = useState<SyncProviderConfig>(getSyncConfig);
    const [status, setStatus] = useState(getSyncStatus);
    const [action, setAction] = useState<SyncAction>('idle');
    const [testResult, setTestResult] = useState<'idle' | 'success' | 'error'>('idle');
    const [summary, setSummary] = useState<string | null>(null);
    // A sync library read from a file, held until the person confirms that it replaces the local one.
    const [pendingImport, setPendingImport] = useState<SyncLibraryExportBundle | null>(null);

    useEffect(() => {
        const unsubscribeConfig = subscribeSyncConfig(() => {
            const next = getSyncConfig();
            setSaved(next);
            setDraft(next);
        });
        const unsubscribeStatus = subscribeSyncStatus(() => setStatus(getSyncStatus()));
        return () => {
            unsubscribeConfig();
            unsubscribeStatus();
        };
    }, []);

    const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
    const configured = Boolean(draft.workerBaseUrl.trim() && draft.authToken.trim());
    const statusLabel = status.state === 'error'
        ? (status.lastError || t('options.r2SyncStatusError'))
        : status.lastSyncAt
            ? `${t('options.r2SyncLastSync')}: ${new Date(status.lastSyncAt).toLocaleString()}`
            : t('options.r2SyncStatusIdle');
    const statusTone: 'ok' | 'error' | undefined = testResult === 'success'
        ? 'ok'
        : testResult === 'error' || (!summary && status.state === 'error') ? 'error' : undefined;

    const update = (patch: Partial<SyncProviderConfig>) => {
        setDraft(previous => ({ ...previous, ...patch, provider: SYNC_PROVIDER }));
    };

    const save = () => {
        saveSyncConfig(draft);
        setSaved(getSyncConfig());
    };

    const test = async () => {
        setAction('testing');
        setTestResult('idle');
        setSummary(null);
        const next = {
            ...draft,
            workerBaseUrl: draft.workerBaseUrl.trim().replace(/\/+$/, ''),
            authToken: draft.authToken.trim(),
        };
        try {
            if (await testSyncProviderConnection(next)) {
                saveSyncConfig(next);
                setSaved(getSyncConfig());
                setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
                setTestResult('success');
                setSummary(t('ui.storage.syncTestSuccess'));
            } else {
                setTestResult('error');
                setSummary(t('ui.storage.syncTestFailed'));
            }
        } catch (error) {
            setTestResult('error');
            setSummary(errorText(error));
            setSyncStatus({ state: 'error', lastError: errorText(error) });
        } finally {
            setAction('idle');
            // The result keeps its colour for a moment; the line itself stays.
            window.setTimeout(() => setTestResult('idle'), 3000);
        }
    };

    const syncThemes = async () => {
        if (dirty) {
            save();
        }
        setAction('syncing');
        setSummary(null);
        try {
            const result = await syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false });
            if (result) {
                setSummary(t('ui.storage.syncThemesComplete', {
                    uploaded: result.uploadedThemeCount,
                    downloaded: result.downloadedThemeCount,
                    local: result.checkedLocalThemeCount,
                    diff: result.diffBucketCount,
                }));
            }
        } finally {
            setAction('idle');
        }
    };

    const syncSettings = async () => {
        if (dirty) {
            save();
        }
        setAction('syncingSettings');
        setSummary(null);
        try {
            const result = await syncNow({ syncThemes: false, applyRemoteSettings: true, pushSettings: true });
            if (result) {
                const parts: string[] = [];
                if (result.appliedRemoteSettings) parts.push(t('ui.storage.syncAppliedRemote'));
                if (result.pushedLocalSettings) parts.push(t('ui.storage.syncPushedLocal'));
                setSummary(parts.length > 0
                    ? t('ui.storage.syncSettingsComplete', { details: parts.join(', ') })
                    : t('ui.storage.syncSettingsNoChange'));
            }
        } finally {
            setAction('idle');
        }
    };

    /** Writes the sync library to a zip file and hands it to the browser as a download. */
    const exportLibrary = async () => {
        setAction('exporting');
        try {
            const url = createSafeObjectUrl(createSyncLibraryZipBlob(await exportSyncLibraryBundle()));
            if (!url) throw new TypeError('Sync export must produce a Blob');
            const link = document.createElement('a');
            link.href = url;
            link.download = `folia-sync-${formatLocalDateTimeStamp()}.zip`;
            link.click();
            URL.revokeObjectURL(url);
        } finally {
            setAction('idle');
        }
    };

    /** Reads a zip or JSON sync library and holds it for the confirmation; the import stays "running" until that is answered. */
    const readImportFile = async (file: File) => {
        setAction('importing');
        try {
            const parsed = file.name.toLowerCase().endsWith('.zip')
                ? await readSyncLibraryZipFile(file)
                : JSON.parse(await file.text()) as unknown;
            if (!isSyncLibraryExportBundle(parsed)) {
                throw new Error('Invalid Folia sync export');
            }
            setPendingImport(parsed);
        } catch (error) {
            setSyncStatus({ state: 'error', lastError: errorText(error) });
            setAction('idle');
        }
    };

    const cancelImport = () => {
        setPendingImport(null);
        setAction('idle');
    };

    /** Replaces the local sync library with the file that was read, and pushes it to the server when sync is on. */
    const confirmImport = async () => {
        const bundle = pendingImport;
        setPendingImport(null);
        try {
            await importSyncLibraryBundle(bundle, { pushRemote: draft.enabled && configured });
        } catch (error) {
            setSyncStatus({ state: 'error', lastError: errorText(error) });
        } finally {
            setAction('idle');
        }
    };

    return {
        draft,
        dirty,
        configured,
        action,
        statusText: summary || statusLabel,
        statusTone,
        hasPendingImport: pendingImport !== null,
        update,
        save,
        test,
        syncThemes,
        syncSettings,
        exportLibrary,
        readImportFile,
        cancelImport,
        confirmImport,
    };
};
