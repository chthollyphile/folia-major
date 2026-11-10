import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../../../../shared/ConfirmDialog';
import { Button, Link, Reveal, Row, Status, TextField, Toggle, useSettingsKitTheme } from '../../kit';
import { O } from './options';
import { useSyncServer } from './useSyncServer';

// src/components/modal/settings/pages/integration/SyncServerRows.tsx
// The sync server rows of the 连接与集成 page: the switch, the server's address and token under it,
// a row that says how the last action went beside the two syncs, and a last row with the file
// export and import, the test and the save. The rows stay open while there is something unsaved,
// so a switch just turned off can still be saved.

const DEPLOY_DOCS_URL = 'https://folia-site.cielaniska.top/guide/deploy-sync';

export const SyncServerRows: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const sync = useSyncServer();
    const importInputRef = useRef<HTMLInputElement>(null);
    const busy = sync.action !== 'idle';
    const cannotSync = !sync.draft.enabled || !sync.configured || busy;

    return (
        <>
            <Row
                option={O.sync}
                hint={<>{t('options.r2SyncEnableDesc')} <Link href={DEPLOY_DOCS_URL}>{t('options.r2SyncDeployDocs')}</Link></>}
            >
                <Toggle checked={sync.draft.enabled} onChange={enabled => sync.update({ enabled })} />
            </Row>
            <Reveal when={sync.draft.enabled || sync.dirty}>
                <Row sub option={O.syncUrl}>
                    <TextField
                        type="url"
                        value={sync.draft.workerBaseUrl}
                        onChange={workerBaseUrl => sync.update({ workerBaseUrl })}
                        placeholder="https://folia-sync.example.workers.dev"
                    />
                </Row>
                <Row sub option={O.syncToken}>
                    <TextField
                        type="password"
                        value={sync.draft.authToken}
                        onChange={authToken => sync.update({ authToken })}
                        placeholder={t('options.r2SyncTokenPlaceholder')}
                    />
                </Row>
                <Row sub label={<Status tone={sync.statusTone}>{sync.statusText}</Status>}>
                    <Button onClick={() => void sync.syncThemes()} disabled={cannotSync}>
                        {sync.action === 'syncing' ? t('options.r2SyncSyncing') : t('options.r2SyncNow')}
                    </Button>
                    <Button onClick={() => void sync.syncSettings()} disabled={cannotSync}>
                        {sync.action === 'syncingSettings' ? t('options.r2SyncSyncing') : t('options.syncVisualSettings')}
                    </Button>
                </Row>
                <Row sub>
                    <Button onClick={() => void sync.exportLibrary()} disabled={busy}>
                        {sync.action === 'exporting' ? t('options.r2SyncExporting') : t('options.r2SyncExportLibrary')}
                    </Button>
                    <Button onClick={() => importInputRef.current?.click()} disabled={busy}>
                        {sync.action === 'importing' ? t('options.r2SyncImporting') : t('options.r2SyncImportLibrary')}
                    </Button>
                    <Button onClick={() => void sync.test()} disabled={!sync.configured || busy}>
                        {sync.action === 'testing' ? t('options.r2SyncTesting') : t('options.r2SyncTest')}
                    </Button>
                    <Button variant="primary" onClick={sync.save} disabled={!sync.dirty}>
                        {t('options.r2SyncSave')}
                    </Button>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/zip,.zip,application/json,.json"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            // Emptied so the same file can be picked again.
                            event.target.value = '';
                            if (file) void sync.readImportFile(file);
                        }}
                    />
                </Row>
            </Reveal>
            <ConfirmDialog
                isOpen={sync.hasPendingImport}
                title={t('options.r2SyncImportLibrary')}
                description={t('options.r2SyncImportConfirm')}
                confirmVariant="danger"
                isDaylight={isDaylight}
                onConfirm={() => void sync.confirmImport()}
                onClose={sync.cancelImport}
            />
        </>
    );
};

export default SyncServerRows;
