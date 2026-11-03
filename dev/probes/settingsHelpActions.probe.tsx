import React, { useMemo, useState } from 'react';
import ReleaseNotesDialog from '../../src/components/modal/ReleaseNotesDialog';
import { SettingsKitThemeContext, settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../src/components/modal/settings/kit/motion';
import HelpPage from '../../src/components/modal/settings/pages/HelpPage';
import { SettingsPageContext, type SettingsPageContextValue } from '../../src/components/modal/settings/pages/settingsPageContext';
import PonderHost from '../../src/components/ponder/PonderHost';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';

// dev/probes/settingsHelpActions.probe.tsx
// 只挂帮助页，不挂真的 SettingsModal：页面从设置窗口拿的只有更新状态（这里没有新版本）和
// 打开两个对话框的回调。

const PAGE_CONTEXT = {
    viewProps: {
        desktop: { model: { electronSettings: {}, updateStatus: null } },
    },
} as unknown as SettingsPageContextValue;

const ProbeBody: React.FC = () => {
    const [showReleaseNotes, setShowReleaseNotes] = useState(false);
    const kitTheme = useMemo(() => ({ isDaylight: false, theme: DEFAULT_THEME }), []);

    return (
        <div
            data-ponder-page-scope="help-page"
            className="min-h-screen bg-zinc-950 p-10 text-white"
            style={{ '--text-primary': '#fafafa', '--text-secondary': '#a1a1aa' } as React.CSSProperties}
        >
            <div
                className="st-window mx-auto max-w-3xl rounded-2xl bg-[var(--st-win)] px-8 pb-10 pt-2 text-[color:var(--st-t1)]"
                style={{ ...settingsTokens(false, DEFAULT_THEME), ...kitMotionTokens(false) }}
            >
                <SettingsKitThemeContext.Provider value={kitTheme}>
                    <SettingsPageContext.Provider value={PAGE_CONTEXT}>
                        <HelpPage
                            onOpenReleaseNotes={() => setShowReleaseNotes(true)}
                            onOpenAiHelp={() => {}}
                            onProjectLabelClick={() => {}}
                        />
                    </SettingsPageContext.Provider>
                </SettingsKitThemeContext.Provider>
            </div>
            <ReleaseNotesDialog
                isOpen={showReleaseNotes}
                isDaylight={false}
                onClose={() => setShowReleaseNotes(false)}
            />
            <PonderHost theme={DEFAULT_THEME} isDaylight={false} />
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'settingsHelpActions',
    title: 'Help · 版本更新与页面思索入口',
    description: '验证两个入口各自打开 release notes 和 Help 页面级 Ponder。',
    Component: ProbeBody,
};

export default probe;
