import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectWebObsSource } from '../../../../../services/obs/webObsTarget';
import { useStageSettingsStore } from '../../../../../stores/useStageSettingsStore';
import { setStatusMessage } from '../../../../../stores/useStatusMessageStore';
import { compressConfig } from '../../../../../utils/appearanceCodec';
import type { ImportPlan } from '../../../../../utils/appearanceImportPlan';
import ImportConfirmDialog from '../../ImportConfirmDialog';
import { Button, CopyButton, Reveal, Row, Select, TextArea, useSettingsKitTheme } from '../../kit';
import ObsLinkRows from '../ObsLinkRows';
import { useSettingsPage } from '../settingsPageContext';
import { O } from './options';
import { applyImportedConfig, buildCurrentConfig, planConfigImport, type ExportThemeChoice } from './visualConfigTransfer';

// src/components/modal/settings/pages/storage/ConfigTransferRows.tsx
// The rows of the 备份与导入 group: copying the visual settings as a config code or as JSON, with
// or without a theme, and pasting a config to take it over. A pasted config is first shown in the
// import dialog, which lists what it would change; only what is picked there is applied. The web
// build also has the OBS link here while its stage mode is on.

export const ConfigTransferRows: React.FC = () => {
    const { t } = useTranslation();
    const { isElectron, viewProps } = useSettingsPage();
    const { isDaylight } = useSettingsKitTheme();
    const theme = viewProps.appearance;
    const { aiTheme, customTheme } = theme;
    const webObsSource = useStageSettingsStore(selectWebObsSource);
    const [importText, setImportText] = useState('');
    // The parsed config, held back until the person confirms which groups to take.
    const [pendingImport, setPendingImport] = useState<{ config: unknown; plan: ImportPlan } | null>(null);
    const [exportThemeType, setExportThemeType] = useState<ExportThemeChoice>(() => {
        if (theme.bgMode === 'ai' && aiTheme) return 'ai';
        if (customTheme) return 'custom';
        return 'none';
    });
    // A deliberate pick freezes the auto-follow below; without it the effect keeps overwriting the
    // person's choice on any theme change.
    const exportThemePickedRef = useRef(false);
    const pickExportThemeType = (value: ExportThemeChoice) => {
        exportThemePickedRef.current = true;
        setExportThemeType(value);
    };

    // Until the person picks, track whichever theme is available (AI-preferred); after a pick,
    // repair only: demote to 'none' when the picked option's theme disappears.
    useEffect(() => {
        setExportThemeType((previous) => {
            if (!exportThemePickedRef.current) return aiTheme ? 'ai' : customTheme ? 'custom' : 'none';
            return (previous === 'ai' && !aiTheme) || (previous === 'custom' && !customTheme) ? 'none' : previous;
        });
    }, [aiTheme, customTheme]);

    const exportThemeOptions: Array<{ value: ExportThemeChoice; label: string }> = [
        ...(aiTheme ? [{ value: 'ai' as const, label: `${t('options.exportAiTheme')}: ${aiTheme.light.name || 'AI'}` }] : []),
        ...(customTheme ? [{ value: 'custom' as const, label: `${t('options.exportCustomTheme')}: ${customTheme.light.name || 'Custom'}` }] : []),
        { value: 'none', label: t('options.exportNoTheme') },
    ];

    const failImport = (error: unknown) => {
        console.error('[Settings] Import settings failed:', error);
        setStatusMessage({ type: 'error', text: t('options.importFailed') });
    };

    // The dialog is shown even when nothing differs: "your settings already match this" is worth seeing.
    const planImport = () => {
        try {
            setPendingImport(planConfigImport(importText, theme));
        } catch (error) {
            failImport(error);
        }
    };

    const applyImport = (keys: string[]) => {
        if (!pendingImport) {
            return;
        }
        try {
            applyImportedConfig(pendingImport.config, keys, theme);
            setStatusMessage({ type: 'success', text: t('options.importSuccess') });
            setImportText('');
        } catch (error) {
            failImport(error);
        }
        setPendingImport(null);
    };

    return (
        <>
            <Row option={O.exportConfig}>
                <Select value={exportThemeType} options={exportThemeOptions} onChange={pickExportThemeType} />
                <CopyButton text={() => JSON.stringify(buildCurrentConfig(theme, exportThemeType), null, 2)}>{t('options.copyJson')}</CopyButton>
                <CopyButton text={() => compressConfig(buildCurrentConfig(theme, exportThemeType))}>{t('options.exportBtn')}</CopyButton>
            </Row>
            <Row
                option={O.importConfig}
                below={<TextArea value={importText} onChange={setImportText} placeholder={t('options.importPlaceholder')} />}
            >
                <Button variant="primary" onClick={planImport} disabled={!importText.trim()}>{t('options.importBtn')}</Button>
            </Row>
            {!isElectron && (
                <Reveal when={webObsSource !== null}>
                    <ObsLinkRows />
                </Reveal>
            )}
            <ImportConfirmDialog
                isOpen={pendingImport !== null}
                plan={pendingImport?.plan ?? null}
                isDaylight={isDaylight}
                onCancel={() => setPendingImport(null)}
                onConfirm={applyImport}
            />
        </>
    );
};

export default ConfigTransferRows;
