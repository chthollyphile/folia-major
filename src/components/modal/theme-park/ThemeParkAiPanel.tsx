import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DualTheme } from '../../../types';
import { Button, CopyButton, Group, Row, type SettingsGroupDef } from '../settings/kit';
import { AiThemeJsonBox, buildAiThemePrompt, useAiThemeImport, type AiThemePromptSource } from './aiThemeTransfer';

// src/components/modal/theme-park/ThemeParkAiPanel.tsx
// AI tab: the manual round trip the quick editor already offered — copy the generation prompt,
// paste an AI JSON result back in, or copy the current draft as JSON.

type ThemeParkAiPanelProps = {
    promptSource: AiThemePromptSource;
    buildFinalTheme: () => DualTheme;
    fallbackTheme: DualTheme;
    onImportTheme: (theme: DualTheme) => void;
};

const IMPORT_GROUP: SettingsGroupDef = { id: 'theme-park-ai-import', titleKey: 'theme.tabAi' };
const EXPORT_GROUP: SettingsGroupDef = { id: 'theme-park-ai-export', titleKey: 'theme.exportDraftJson' };

const ThemeParkAiPanel: React.FC<ThemeParkAiPanelProps> = ({
    promptSource,
    buildFinalTheme,
    fallbackTheme,
    onImportTheme,
}) => {
    const { t } = useTranslation();
    // Imported JSON lands in the draft rather than being saved straight away, so it can be
    // previewed and tweaked before it replaces the live theme.
    const importer = useAiThemeImport(fallbackTheme, onImportTheme);

    return (
        <>
            <Group def={IMPORT_GROUP} bare foot={t('theme.importJsonToDraftHint')}>
                <Row label={t('aiHelp.copyPromptTitle')}>
                    <CopyButton text={() => buildAiThemePrompt(promptSource)}>{t('aiHelp.copyPrompt')}</CopyButton>
                </Row>
                <Row label={t('aiHelp.importJsonTitle')} below={<AiThemeJsonBox importer={importer} />}>
                    <Button onClick={importer.apply} disabled={!importer.canApply}>{t('theme.importJsonToDraft')}</Button>
                </Row>
            </Group>

            <Group def={EXPORT_GROUP} bare>
                <Row label={t('theme.exportDraftJson')}>
                    <CopyButton text={() => JSON.stringify(buildFinalTheme(), null, 2)}>{t('options.copyThemeJson')}</CopyButton>
                </Row>
            </Group>
        </>
    );
};

export default ThemeParkAiPanel;
