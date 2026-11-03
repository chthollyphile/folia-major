import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LYRIC_EXPORT_COMMAND_ID } from '../../../command-palette/commands/lyricExportCommands';
import ConfirmDialog from '../../../shared/ConfirmDialog';
import { clearAllData } from '../../../../services/db';
import { openCommandPaletteCommand } from '../../../../stores/useAppViewStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { closeSettings } from '../../../../stores/useSettingsModalStore';
import { Button, CopyValue, FoldedGroup, Group, Row, Select, Toggle, Value, useSettingsKitTheme, type SettingsOptionDef } from '../kit';
import { useSettingsPage } from './settingsPageContext';
import ConfigTransferRows from './storage/ConfigTransferRows';
import FolderWatchGroup from './storage/FolderWatchGroup';
import { BACKUP, CACHE_ROWS, CACHES, MEDIA, O } from './storage/options';

// src/components/modal/settings/pages/StoragePage.tsx
// The 存储与备份 page: what Folia keeps on disk and how to carry its look to another Folia. The
// song cache first (on or off, and in the desktop app where it is and how large it may grow), then
// what each kind of cache takes with a button to clear it, the watch on imported folders, and a
// folded group for copying and pasting the visual settings as a config code. The cache sizes and
// the cache folder are the settings dialog's own state.

export const OPTIONS: SettingsOptionDef[] = [...Object.values(O), ...CACHE_ROWS.map(row => row.option)];

// Zero is "no ceiling", which is a real answer rather than a missing one, so it gets a name.
const CACHE_LIMITS_GB = [1, 2, 5, 10, 20, 50, 0];

const StoragePage: React.FC = () => {
    const { t } = useTranslation();
    const { isElectron, viewProps } = useSettingsPage();
    const { isDaylight } = useSettingsKitTheme();
    const { cacheDirectory, cacheDirectoryIsDefault, cacheDirectoryStatus, cacheSizes, isCleaning, mediaCount, onChooseCacheDirectory, onClear } = viewProps.storage;
    const mediaCacheEnabled = useAudioSettingsStore(state => state.enableMediaCache);
    const setMediaCacheEnabled = useAudioSettingsStore(state => state.handleToggleMediaCache);
    const cacheLimitGb = useAudioSettingsStore(state => state.mediaCacheLimitGb);
    const setCacheLimitGb = useAudioSettingsStore(state => state.handleSetMediaCacheLimitGb);
    const [clearingAll, setClearingAll] = useState<'no' | 'asking' | 'running'>('no');

    // Everything the app stored goes, so it starts again from an empty state.
    const clearEverything = async () => {
        setClearingAll('running');
        await clearAllData();
        window.location.reload();
    };

    return (
        <>
            <Group def={MEDIA}>
                <Row option={O.mediaCache} hint={t('options.enableMediaCacheDesc')}>
                    <Toggle checked={mediaCacheEnabled} onChange={setMediaCacheEnabled} />
                </Row>
                {isElectron && (
                    <>
                        <Row
                            option={O.cacheDirectory}
                            hint={t(cacheDirectoryIsDefault ? 'options.cacheDirectoryDefaultHint' : 'options.cacheDirectoryCustomHint')}
                        >
                            {cacheDirectory ? <CopyValue value={cacheDirectory} /> : <Value>...</Value>}
                            <Button onClick={onChooseCacheDirectory} disabled={cacheDirectoryStatus !== 'idle'}>
                                {t('options.chooseCacheDirectory')}
                            </Button>
                        </Row>
                        <Row option={O.cacheLimit} hint={t('options.mediaCacheLimitDesc')}>
                            <Select
                                value={String(cacheLimitGb)}
                                options={CACHE_LIMITS_GB.map(gigabytes => ({
                                    value: String(gigabytes),
                                    label: gigabytes === 0 ? t('options.mediaCacheLimitNone') : `${gigabytes} GB`,
                                }))}
                                onChange={value => setCacheLimitGb(Number(value))}
                            />
                        </Row>
                    </>
                )}
                <Row label={t('options.cachedSongsCount')}>
                    <Value>{mediaCount} · {cacheSizes.media}</Value>
                </Row>
            </Group>

            <Group
                def={CACHES}
                action={(
                    <Button variant="quiet" onClick={() => setClearingAll('asking')} disabled={clearingAll === 'running'}>
                        {clearingAll === 'running' ? t('options.cacheClearing') : t('options.clearAll')}
                    </Button>
                )}
            >
                {CACHE_ROWS.map(({ category, option }) => (
                    <Row key={category} option={option}>
                        <Value>{cacheSizes[category]}</Value>
                        {category === 'lyrics' && (
                            // Named for the Ponder hint of the lyric export, which finds its entry by this attribute.
                            <span data-ponder-lyric-export-settings-entry className="contents">
                                <Button
                                    onClick={() => {
                                        openCommandPaletteCommand(LYRIC_EXPORT_COMMAND_ID);
                                        closeSettings();
                                    }}
                                >
                                    {t('lyricExport.settingsEntry')}
                                </Button>
                            </span>
                        )}
                        <Button onClick={() => onClear(category)} disabled={isCleaning === category}>
                            {isCleaning === category ? t('options.cacheClearing') : t('ui.clear')}
                        </Button>
                    </Row>
                ))}
            </Group>

            <FolderWatchGroup />

            <FoldedGroup def={BACKUP}>
                <ConfigTransferRows />
            </FoldedGroup>

            <ConfirmDialog
                isOpen={clearingAll === 'asking'}
                title={t('options.clearAll')}
                description={t('options.confirmClearAll')}
                confirmVariant="danger"
                isDaylight={isDaylight}
                onConfirm={() => void clearEverything()}
                onClose={() => setClearingAll('no')}
            />
        </>
    );
};

export default StoragePage;
