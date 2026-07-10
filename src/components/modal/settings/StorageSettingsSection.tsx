import React from 'react';
import { Check, Cloud, Command, Database, Disc3, Download, FolderOpen, Layers, Loader2, Pencil, PlayCircle, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { getSyncConfig, getSyncStatus, saveSyncConfig, setSyncStatus, subscribeSyncConfig, subscribeSyncStatus } from '../../../services/sync/syncConfig';
import { exportSyncLibraryBundle, importSyncLibraryBundle, isSyncLibraryExportBundle, syncNow, testSyncProviderConnection } from '../../../services/sync/syncCoordinator';
import { createSyncLibraryZipBlob, readSyncLibraryZipFile } from '../../../services/sync/syncArchive';
import { SYNC_PROVIDER, type SyncProviderConfig, type SyncRuntimeStatus } from '../../../services/sync/syncTypes';

// src/components/modal/settings/StorageSettingsSection.tsx
// Shared storage and media cache settings used by the main options page and storage subview.

type CacheCategory = 'playlist' | 'lyrics' | 'cover' | 'media';

type CacheSizes = Record<CacheCategory, string>;

type StorageSettingsSectionProps = {
    cacheDirectory: string;
    cacheDirectoryIsDefault: boolean;
    cacheDirectoryStatus: 'idle' | 'choosing';
    cacheSizes: CacheSizes;
    enableMediaCache: boolean;
    errorTextColor: string;
    isCleaning: string | null;
    isElectron: boolean;
    mediaCount: number;
    onChooseCacheDirectory: () => void;
    onClear: (category: CacheCategory) => void;
    onClearAll: () => void;
    onToggleMediaCache: (enabled: boolean) => void;
    settingsCardClass: string;
    settingsIconClass?: string;
    theme?: Theme;
    toggleOffBackgroundClass: string;
    useInsetCacheRows?: boolean;
};

const StorageSettingsSection: React.FC<StorageSettingsSectionProps> = ({
    cacheDirectory,
    cacheDirectoryIsDefault,
    cacheDirectoryStatus,
    cacheSizes,
    enableMediaCache,
    errorTextColor,
    isCleaning,
    isElectron,
    mediaCount,
    onChooseCacheDirectory,
    onClear,
    onClearAll,
    onToggleMediaCache,
    settingsCardClass,
    settingsIconClass,
    theme,
    toggleOffBackgroundClass,
    useInsetCacheRows = false,
}) => {
    const { t } = useTranslation();
    const [syncConfig, setSyncConfig] = React.useState<SyncProviderConfig>(() => getSyncConfig());
    const [draftSyncConfig, setDraftSyncConfig] = React.useState<SyncProviderConfig>(() => getSyncConfig());
    const [syncStatus, setSyncStatusState] = React.useState<SyncRuntimeStatus>(() => getSyncStatus());
    const [syncAction, setSyncAction] = React.useState<'idle' | 'testing' | 'syncing' | 'syncingSettings' | 'exporting' | 'importing'>('idle');
    const [testResult, setTestResult] = React.useState<'idle' | 'success' | 'error'>('idle');
    const [syncSummaryMsg, setSyncSummaryMsg] = React.useState<string | null>(null);
    const syncImportInputRef = React.useRef<HTMLInputElement | null>(null);
    const cacheRowClass = useInsetCacheRows
        ? `flex items-center justify-between p-3 rounded-xl border ${settingsCardClass}`
        : 'flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5';
    const iconClass = useInsetCacheRows && settingsIconClass
        ? `p-2 rounded-lg opacity-60 ${settingsIconClass}`
        : 'p-2 bg-white/5 rounded-lg opacity-60';
    const cacheItems = [
        { id: 'playlist' as const, label: t('options.playlistData') || 'Playlist Data', size: cacheSizes.playlist, icon: Layers },
        { id: 'lyrics' as const, label: t('options.lyrics') || 'Lyrics', size: cacheSizes.lyrics, icon: Command },
        { id: 'cover' as const, label: t('options.covers') || 'Covers', size: cacheSizes.cover, icon: Disc3 },
        { id: 'media' as const, label: t('options.mediaFiles') || 'Media Files', size: cacheSizes.media, icon: PlayCircle },
    ];
    const syncConfigDirty = JSON.stringify(syncConfig) !== JSON.stringify(draftSyncConfig);
    const syncConfigured = Boolean(draftSyncConfig.workerBaseUrl.trim() && draftSyncConfig.authToken.trim());
    const syncStatusLabel = syncStatus.state === 'error'
        ? (syncStatus.lastError || t('options.r2SyncStatusError') || 'Sync failed')
        : syncStatus.lastSyncAt
            ? `${t('options.r2SyncLastSync') || 'Last sync'}: ${new Date(syncStatus.lastSyncAt).toLocaleString()}`
            : (t('options.r2SyncStatusIdle') || 'Not synced yet');

    React.useEffect(() => {
        const unsubscribeConfig = subscribeSyncConfig(() => {
            const nextConfig = getSyncConfig();
            setSyncConfig(nextConfig);
            setDraftSyncConfig(nextConfig);
        });
        const unsubscribeStatus = subscribeSyncStatus(() => setSyncStatusState(getSyncStatus()));
        return () => {
            unsubscribeConfig();
            unsubscribeStatus();
        };
    }, []);

    const updateDraftSyncConfig = (patch: Partial<SyncProviderConfig>) => {
        setDraftSyncConfig(prev => ({
            ...prev,
            ...patch,
            provider: SYNC_PROVIDER,
        }));
    };

    const handleSaveSyncConfig = () => {
        saveSyncConfig(draftSyncConfig);
        setSyncConfig(getSyncConfig());
    };

    const handleTestSync = async () => {
        setSyncAction('testing');
        setTestResult('idle');
        setSyncSummaryMsg(null);
        const nextConfig = {
            ...draftSyncConfig,
            workerBaseUrl: draftSyncConfig.workerBaseUrl.trim().replace(/\/+$/, ''),
            authToken: draftSyncConfig.authToken.trim(),
        };
        try {
            const ok = await testSyncProviderConnection(nextConfig);
            if (ok) {
                saveSyncConfig(nextConfig);
                setSyncConfig(getSyncConfig());
                setSyncStatus({ state: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
                setTestResult('success');
                setSyncSummaryMsg('测试成功 (Test Successful)');
            } else {
                setTestResult('error');
                setSyncSummaryMsg('连接失败或凭证无效 (Connection Failed)');
            }
        } catch (error) {
            setTestResult('error');
            setSyncSummaryMsg(error instanceof Error ? error.message : String(error));
            setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        } finally {
            setSyncAction('idle');
            setTimeout(() => setTestResult('idle'), 3000);
        }
    };

    const handleSyncNow = async () => {
        if (syncConfigDirty) {
            handleSaveSyncConfig();
        }
        setSyncAction('syncing');
        setSyncSummaryMsg(null);
        try {
            const summary = await syncNow({ syncThemes: true, applyRemoteSettings: false, pushSettings: false });
            if (summary) {
                setSyncSummaryMsg(`主题同步完成。上传 ${summary.uploadedThemeCount} 个，下载 ${summary.downloadedThemeCount} 个，本地 ${summary.checkedLocalThemeCount} 个，共处理 ${summary.diffBucketCount} 个差异桶。`);
            }
        } finally {
            setSyncAction('idle');
        }
    };

    const handleSyncSettings = async () => {
        if (syncConfigDirty) {
            handleSaveSyncConfig();
        }
        setSyncAction('syncingSettings');
        setSyncSummaryMsg(null);
        try {
            const summary = await syncNow({ syncThemes: false, applyRemoteSettings: true, pushSettings: true });
            if (summary) {
                const parts = [];
                if (summary.appliedRemoteSettings) parts.push('已拉取并应用云端设置');
                if (summary.pushedLocalSettings) parts.push('已向云端推送本地最新设置');
                setSyncSummaryMsg(parts.length > 0 ? `视觉设置同步完成。${parts.join('，')}。` : '视觉设置与云端一致，无需同步。');
            }
        } finally {
            setSyncAction('idle');
        }
    };

    const handleExportSyncLibrary = async () => {
        setSyncAction('exporting');
        try {
            const bundle = await exportSyncLibraryBundle();
            const blob = createSyncLibraryZipBlob(bundle);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `folia-sync-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
            link.click();
            URL.revokeObjectURL(url);
        } finally {
            setSyncAction('idle');
        }
    };

    const handleImportSyncLibrary = async (file: File | null) => {
        if (!file) {
            return;
        }

        setSyncAction('importing');
        try {
            const parsed = file.name.toLowerCase().endsWith('.zip')
                ? await readSyncLibraryZipFile(file)
                : JSON.parse(await file.text()) as unknown;
            if (!isSyncLibraryExportBundle(parsed)) {
                throw new Error('Invalid Folia sync export');
            }
            const shouldImport = window.confirm(t('options.r2SyncImportConfirm') || 'Import this sync library and overwrite local sync cache?');
            if (!shouldImport) {
                return;
            }
            await importSyncLibraryBundle(parsed, {
                pushRemote: draftSyncConfig.enabled && syncConfigured,
            });
        } catch (error) {
            setSyncStatus({ state: 'error', lastError: error instanceof Error ? error.message : String(error) });
        } finally {
            setSyncAction('idle');
            if (syncImportInputRef.current) {
                syncImportInputRef.current.value = '';
            }
        }
    };

    return (
        <>
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Database size={14} /> {t('options.cacheDetails') || 'Cache Storage'}
                    <button
                        onClick={onClearAll}
                        disabled={isCleaning === 'all'}
                        className={`ml-auto text-xs font-normal normal-case tracking-normal px-2 py-1 hover:bg-white/10 rounded-lg ${errorTextColor} opacity-60 hover:opacity-100 transition-all disabled:opacity-20 flex items-center gap-1`}
                    >
                        {isCleaning === 'all' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        {t('options.clearAll')}
                    </button>
                </h3>

                <div className="grid grid-cols-2 gap-3">
                    {cacheItems.map((item) => (
                        <div key={item.id} className={cacheRowClass}>
                            <div className="flex items-center gap-3">
                                <div className={iconClass}>
                                    <item.icon size={16} />
                                </div>
                                <div>
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                                    <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{item.size}</div>
                                </div>
                            </div>
                            <button
                                onClick={() => onClear(item.id)}
                                disabled={isCleaning === item.id}
                                className={`p-2 hover:bg-white/10 rounded-lg ${errorTextColor} opacity-60 hover:opacity-100 transition-all disabled:opacity-20`}
                                title="Clear"
                            >
                                {isCleaning === item.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Cloud size={14} /> {t('options.r2Sync') || 'Sync Server'}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.r2SyncEnable') || 'Enable sync server'}
                            </div>
                            <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.r2SyncEnableDesc') || 'Sync appearance settings and AI themes through your own Cloudflare D1 Worker or self-hosted sync service.'}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateDraftSyncConfig({ enabled: !draftSyncConfig.enabled })}
                            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!draftSyncConfig.enabled ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: draftSyncConfig.enabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${draftSyncConfig.enabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className="space-y-3">
                        <label className="block space-y-1">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.r2SyncWorkerUrl') || 'Sync Server URL'}
                            </span>
                            <input
                                type="url"
                                value={draftSyncConfig.workerBaseUrl}
                                onChange={(event) => updateDraftSyncConfig({ workerBaseUrl: event.target.value })}
                                placeholder="https://folia-sync.example.workers.dev"
                                className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                        <label className="block space-y-1">
                            <span className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.r2SyncToken') || 'Bearer Token'}
                            </span>
                            <input
                                type="password"
                                value={draftSyncConfig.authToken}
                                onChange={(event) => updateDraftSyncConfig({ authToken: event.target.value })}
                                placeholder={t('options.r2SyncTokenPlaceholder') || 'Worker SYNC_TOKEN'}
                                className="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm outline-none focus:border-white/25"
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </label>
                    </div>

                    <div className="flex flex-col gap-3">
                        {/* 基础配置与备份功能 */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleSaveSyncConfig}
                                    disabled={!syncConfigDirty}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <Check size={14} />
                                    {t('options.r2SyncSave') || 'Save'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleTestSync()}
                                    disabled={!syncConfigured || syncAction !== 'idle'}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {syncAction === 'testing' ? <Loader2 size={14} className="animate-spin" /> : 
                                     testResult === 'success' ? <Check size={14} className="text-green-500" /> :
                                     testResult === 'error' ? <X size={14} className="text-red-500" /> :
                                     <Cloud size={14} />}
                                    {t('options.r2SyncTest') || 'Test'}
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => void handleExportSyncLibrary()}
                                    disabled={syncAction !== 'idle'}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {syncAction === 'exporting' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    {t('options.r2SyncExportLibrary') || 'Export library'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => syncImportInputRef.current?.click()}
                                    disabled={syncAction !== 'idle'}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {syncAction === 'importing' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                    {t('options.r2SyncImportLibrary') || 'Import library'}
                                </button>
                            </div>
                        </div>

                        {/* 核心同步功能 */}
                        <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-white/5">
                            <button
                                type="button"
                                onClick={() => void handleSyncNow()}
                                disabled={!draftSyncConfig.enabled || !syncConfigured || syncAction !== 'idle'}
                                className="flex-1 px-3 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg text-xs font-medium transition-colors flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-blue-400"
                            >
                                {syncAction === 'syncing' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                {t('options.r2SyncNow') || 'Sync AI Themes'}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSyncSettings()}
                                disabled={!draftSyncConfig.enabled || !syncConfigured || syncAction !== 'idle'}
                                className="flex-1 px-3 py-2.5 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg text-xs font-medium transition-colors flex justify-center items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-purple-400"
                            >
                                {syncAction === 'syncingSettings' ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
                                {t('options.syncVisualSettings') || '同步视觉设置'}
                            </button>
                        </div>

                        <input
                            ref={syncImportInputRef}
                            type="file"
                            accept="application/zip,.zip,application/json,.json"
                            className="hidden"
                            onChange={(event) => void handleImportSyncLibrary(event.target.files?.[0] ?? null)}
                        />
                    </div>

                    <div className={`rounded-lg border px-3 py-2 text-xs ${(syncStatus.state === 'error' || testResult === 'error') && !syncSummaryMsg ? errorTextColor : testResult === 'success' ? 'text-green-500 border-green-500/20 bg-green-500/5' : ''}`} style={{ color: testResult === 'success' || testResult === 'error' ? undefined : 'var(--text-secondary)' }}>
                        {syncSummaryMsg || syncStatusLabel}
                    </div>
                </div>
            </section>

            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Database size={14} /> {t('options.mediaCache') || 'Media Cache'}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.enableMediaCache') || 'Cache Songs'}
                            </div>
                            <div className="text-xs opacity-50 max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.enableMediaCacheDesc') || 'Cache audio after playback for offline listening.'}
                            </div>
                        </div>
                        <button
                            onClick={() => onToggleMediaCache(!enableMediaCache)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!enableMediaCache ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: enableMediaCache ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enableMediaCache ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    {isElectron && (
                        <div className="pt-3 border-t border-white/10 space-y-3">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    <FolderOpen size={14} />
                                    {t('options.cacheDirectory') || 'Cache Directory'}
                                </div>
                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.cacheDirectoryDesc') || 'Choose where large desktop cache files should be stored.'}
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <div className="flex-1 bg-black/10 rounded-lg border border-white/5 px-3 py-2 min-w-0">
                                    <div className="text-[11px] break-all font-mono" style={{ color: 'var(--text-primary)' }}>
                                        {cacheDirectory || '...'}
                                    </div>
                                    <div className="text-[10px] opacity-45 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {cacheDirectoryIsDefault
                                            ? (t('options.cacheDirectoryDefaultHint') || 'Using the default desktop cache location.')
                                            : (t('options.cacheDirectoryCustomHint') || 'Using a custom cache location.')}
                                    </div>
                                </div>
                                <button
                                    onClick={onChooseCacheDirectory}
                                    disabled={cacheDirectoryStatus !== 'idle'}
                                    className="shrink-0 w-12 rounded-lg text-sm font-medium transition-colors flex items-center justify-center bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={{ color: 'var(--text-primary)' }}
                                    title={t('options.chooseCacheDirectory') || 'Choose Folder'}
                                    aria-label={t('options.chooseCacheDirectory') || 'Choose Folder'}
                                >
                                    {cacheDirectoryStatus === 'choosing' ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="pt-3 border-t border-white/10 flex justify-between items-center text-xs opacity-50">
                        <span>{t('options.cachedSongsCount') || 'Cached Songs'}:</span>
                        <span className="font-mono">{mediaCount}</span>
                    </div>
                </div>
            </section>
        </>
    );
};

export default StorageSettingsSection;
