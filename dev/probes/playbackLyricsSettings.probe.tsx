import React, { useMemo } from 'react';
import { SettingsKitThemeContext, settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../src/components/modal/settings/kit/motion';
import { SettingsAnchorProvider, useSettingsAnchorStore } from '../../src/components/modal/settings/navigation/SettingsAnchorContext';
import LyricsPage from '../../src/components/modal/settings/pages/LyricsPage';
import { SettingsPageContext, type SettingsPageContextValue } from '../../src/components/modal/settings/pages/settingsPageContext';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';
// dev/probes/playbackLyricsSettings.probe.tsx

/**
 * 设置里的「歌词」页。
 *
 * 歌词过滤入口是从实验室搬过来的，这里主要确认它作为「全局时间偏移」的同组兄弟项
 * 渲染正常：两行在同一张卡里相邻，都是点开对话框的行。
 *
 * 只挂这一页，不挂真的 SettingsModal：页面从设置窗口拿的只有打开这两个对话框的回调，
 * 其余设置它自己从 store 读。
 */
const PAGE_CONTEXT = {
    viewProps: {
        playback: {
            onOpenGlobalLyricOffsetSettings: () => {},
            onOpenLyricFilterSettings: () => {},
        },
    },
} as unknown as SettingsPageContextValue;

const PlaybackLyricsSettingsProbe: React.FC = () => {
    const store = useSettingsAnchorStore();
    const kitTheme = useMemo(() => ({ isDaylight: false, theme: DEFAULT_THEME }), []);

    return (
        <div
            className="min-h-screen bg-zinc-950 p-8"
            style={{
                '--text-primary': DEFAULT_THEME.primaryColor,
                '--text-secondary': DEFAULT_THEME.secondaryColor,
            } as React.CSSProperties}
        >
            <div
                className="st-window mx-auto max-w-3xl rounded-2xl bg-[var(--st-win)] px-8 pb-10 pt-2 text-[color:var(--st-t1)]"
                style={{ ...settingsTokens(false, DEFAULT_THEME), ...kitMotionTokens(false) }}
            >
                <SettingsKitThemeContext.Provider value={kitTheme}>
                    <SettingsAnchorProvider store={store} section="lyrics">
                        <SettingsPageContext.Provider value={PAGE_CONTEXT}>
                            <LyricsPage />
                        </SettingsPageContext.Provider>
                    </SettingsAnchorProvider>
                </SettingsKitThemeContext.Provider>
            </div>
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'playbackLyricsSettings',
    title: '设置·歌词页',
    description: '歌词过滤入口与全局时间偏移同组、相邻渲染是否一致',
    Component: PlaybackLyricsSettingsProbe,
};

export default probe;
