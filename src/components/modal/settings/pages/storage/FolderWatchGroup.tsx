import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalLibraryAutoScanState } from '../../../../../hooks/useLocalLibraryAutoScan';
import { refreshLocalLibraryAutoScanRoots } from '../../../../../services/localLibraryAutoScan';
import { useLocalLibrarySettingsStore } from '../../../../../stores/useLocalLibrarySettingsStore';
import type { LocalLibraryAutoScanRootState } from '../../../../../types/localLibraryWatch';
import { Button, Group, Reveal, Row, Status, Toggle } from '../../kit';
import { O, WATCH } from './options';

// src/components/modal/settings/pages/storage/FolderWatchGroup.tsx
// The folder watch group of the 存储与备份 page: the switch, and under it one row for each
// imported folder with whether it is being watched, so a folder that is silently not watched says
// so, then a row with what the watcher last did and a button that looks at the folders again.
// The group is not drawn where the browser cannot watch a folder.

type WatchState = { tone?: 'ok' | 'warn' | 'error'; text: string };

export const FolderWatchGroup: React.FC = () => {
    const { t } = useTranslation();
    const enabled = useLocalLibrarySettingsStore(state => state.autoScanEnabled);
    const setEnabled = useLocalLibrarySettingsStore(state => state.setAutoScanEnabled);
    const autoScan = useLocalLibraryAutoScanState();

    if (!autoScan.supported) {
        return null;
    }

    const rootState = (root: LocalLibraryAutoScanRootState): WatchState => {
        if (root.skipReason === 'permission') {
            return { tone: 'warn', text: t('options.localLibraryWatchNoPermission') };
        }
        if (root.error) {
            return { tone: 'error', text: `${t('options.localLibraryWatchFailed')}: ${root.error}` };
        }
        if (!root.watching) {
            return { text: t('options.localLibraryWatchStarting') };
        }
        if (!root.recursive) {
            return { tone: 'warn', text: t('options.localLibraryWatchRootOnly') };
        }
        return { tone: 'ok', text: t('options.localLibraryWatchActive') };
    };

    // One line for what the watcher is doing or last did; with no folder imported it says that instead.
    const activity = autoScan.attaching
        ? t('options.localLibraryWatchAttaching')
        : autoScan.roots.length === 0
            ? t('options.localLibraryWatchNoFolders')
            : autoScan.scanning
                ? t('options.localLibraryWatchScanning')
                : autoScan.lastScanAt
                    ? `${t('options.localLibraryWatchLastScan')}: ${new Date(autoScan.lastScanAt).toLocaleString()}`
                    : t('options.localLibraryWatchNeverScanned');

    return (
        <Group def={WATCH}>
            <Row option={O.autoScan} hint={t('options.localLibraryAutoScanDesc')}>
                <Toggle checked={enabled} onChange={setEnabled} />
            </Row>
            <Reveal when={enabled}>
                {autoScan.roots.map((root) => {
                    const state = rootState(root);
                    return (
                        <Row key={root.rootFolderName} sub label={root.rootFolderName}>
                            <Status tone={state.tone}>{state.text}</Status>
                        </Row>
                    );
                })}
                <Row sub label={<Status>{activity}</Status>}>
                    <Button onClick={() => void refreshLocalLibraryAutoScanRoots()} disabled={autoScan.attaching}>
                        {t('options.localLibraryWatchRecheck')}
                    </Button>
                </Row>
                <Reveal when={Boolean(autoScan.lastError)}>
                    <Row sub label={<Status tone="error">{autoScan.lastError}</Status>} />
                </Reveal>
            </Reveal>
        </Group>
    );
};

export default FolderWatchGroup;
