import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setStatusMessage } from '../../../../../stores/useStatusMessageStore';
import {
    buildSettingsBundle,
    downloadTextFile,
    serializeSettingsBundle,
    SETTINGS_BUNDLE_FILE_NAME,
} from '../../../../../services/settingsTransfer/settingsBundle';
import type { SettingsGroupId } from '../../../../../services/settingsTransfer/settingsCatalog';
import {
    applySettingsImport,
    planSettingsImport,
    type SettingsImportPlan,
} from '../../../../../services/settingsTransfer/settingsImportPlan';
import { Button, CopyButton, Row, TextArea, useSettingsKitTheme } from '../../kit';
import AllSettingsImportDialog from './AllSettingsImportDialog';
import { O } from './options';

// src/components/modal/settings/pages/storage/AllSettingsTransferRows.tsx
// The rows of the 全部设置 group: saving every portable setting as one JSON file, and taking one.
//
// This is not the visual config code beside it. That shortcode is shared with the web build's OBS
// quick import and keeps its shape; this file is a wider document that also carries the functional
// settings and the installed mods. Credentials are in neither: they are not stored under any key
// the catalog names.
//
// A paste is read before it is taken: the dialog lists what would change, group by group, and only
// the groups picked are written. The page then reloads once, because most stores read their stored
// value when they are created.

export const AllSettingsTransferRows: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const [importText, setImportText] = useState('');
    const [pendingPlan, setPendingPlan] = useState<SettingsImportPlan | null>(null);
    const [exporting, setExporting] = useState(false);

    // The bundle is built on the press: reading every catalog key costs a moment and must reflect
    // what is stored now, not what was stored when the page opened.
    const buildBundle = async () => {
        setExporting(true);
        try {
            return await buildSettingsBundle();
        } finally {
            setExporting(false);
        }
    };

    const download = () => {
        void buildBundle()
            .then(bundle => {
                downloadTextFile(serializeSettingsBundle(bundle), SETTINGS_BUNDLE_FILE_NAME);
                setStatusMessage({ type: 'success', text: t('options.allSettingsExported') });
            })
            .catch(error => {
                console.error('[SettingsTransfer] Export failed', error);
                setStatusMessage({ type: 'error', text: t('options.allSettingsExportFailed') });
            });
    };

    const preview = () => {
        try {
            setPendingPlan(planSettingsImport(importText));
        } catch (error) {
            console.error('[SettingsTransfer] Could not read the bundle', error);
            setStatusMessage({ type: 'error', text: t('options.allSettingsImportUnreadable') });
        }
    };

    const apply = (groups: SettingsGroupId[]) => {
        if (!pendingPlan) {
            return;
        }
        try {
            const written = applySettingsImport(pendingPlan, groups);
            // Nothing picked means nothing to start over for: the reload would only be a flash.
            // Saying "nothing picked" when the file held nothing different would be wrong, so the
            // two cases get their own wording.
            if (written === 0) {
                setStatusMessage({
                    type: 'success',
                    text: t(pendingPlan.totalChanged === 0 ? 'options.allSettingsImportNothing' : 'options.allSettingsImportNothingPicked'),
                });
                setPendingPlan(null);
                return;
            }
            setStatusMessage({ type: 'success', text: t('options.allSettingsImportApplied', { n: written }) });
            // The stores have already read their old values; a reload is how the written ones are
            // picked up. Done on the next turn so the status message is on screen for the reload.
            window.setTimeout(() => window.location.reload(), 400);
        } catch (error) {
            console.error('[SettingsTransfer] Import failed', error);
            setStatusMessage({ type: 'error', text: t('options.allSettingsImportFailed') });
            setPendingPlan(null);
        }
    };

    return (
        <>
            <Row option={O.allSettingsExport}>
                <Button variant="primary" onClick={download} disabled={exporting}>
                    {t('options.allSettingsDownload')}
                </Button>
                <CopyButton text={() => buildBundle().then(serializeSettingsBundle)}>
                    {t('options.allSettingsCopyJson')}
                </CopyButton>
            </Row>
            <Row
                option={O.allSettingsImport}
                below={<TextArea value={importText} onChange={setImportText} placeholder={t('options.allSettingsImportPlaceholder')} />}
            >
                <Button variant="primary" onClick={preview} disabled={!importText.trim()}>
                    {t('options.allSettingsPreview')}
                </Button>
            </Row>
            <AllSettingsImportDialog
                isOpen={pendingPlan !== null}
                plan={pendingPlan}
                isDaylight={isDaylight}
                onCancel={() => setPendingPlan(null)}
                onConfirm={apply}
            />
        </>
    );
};

export default AllSettingsTransferRows;
