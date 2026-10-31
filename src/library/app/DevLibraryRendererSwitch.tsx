import React from 'react';
import { useTranslation } from 'react-i18next';
import { listLibrarySuites } from '../registry';
import { useActiveLibrarySuiteId } from './librarySuiteChoice';
import { switchLibrarySuite } from './switchLibrarySuite';

// src/library/app/DevLibraryRendererSwitch.tsx
// 开发验证浮层：在各套 UI suite 之间切换当前打开的集合，
// 用来验收 Library Core（换 UI 不重新请求、不丢筛选与焦点）。保留作开发验证入口，默认关闭；
// 只有开发版显式启用额外 suite 时才装配（TUI 使用 VITE_LIBRARY_TUI=true），不作为正式设置项。
// 按钮列表来自 registry（R3 之前是写死的 grid / tui）；data-renderer 沿用旧名，e2e 用它定位。
// P3.4 起首页上也出现（切换首页 surface）：首页上贴着左下角（bottom-2）——稍高一点的位置是 GridMap 批量面板的
// 按钮，右下角是在线 provider 切换器，顶上是桌面版的标题栏与首页页头；集合层上仍在原来的位置。
// P4.3 起歌手页上也出现：贴着底边居中——左边是网格歌手页的信息面板（编辑歌手的按钮在它底部），右边是专辑列表按钮。
// B0 起和设置项写同一个 store；按下的按钮是实际生效的 suite（store 里的选择可能在这个构建里不可用）。

const PLACEMENT_CLASS = {
    collection: 'bottom-12 left-4',
    artist: 'bottom-2 left-1/2 -translate-x-1/2',
    home: 'bottom-2 left-2',
} as const;

const DevLibraryRendererSwitch: React.FC<{ sessionKey: string; placement?: keyof typeof PLACEMENT_CLASS }> = ({
    sessionKey,
    placement = 'collection',
}) => {
    const { t } = useTranslation();
    const activeSuite = useActiveLibrarySuiteId();

    return (
        <div
            data-testid="dev-library-renderer-switch"
            data-placement={placement}
            className={`fixed ${PLACEMENT_CLASS[placement]} z-[120] flex items-center gap-1 rounded-full border border-dashed border-current/30 px-2 py-1 font-mono text-[11px]`}
            style={{
                backgroundColor: 'color-mix(in srgb, var(--bg-color) 80%, transparent)',
                color: 'var(--text-primary)',
            }}
        >
            <span className="px-1 opacity-50">{`DEV · ${t('libraryTui.rendererSwitch')}`}</span>
            {listLibrarySuites().map(suite => (
                <button
                    key={suite.id}
                    type="button"
                    data-renderer={suite.id}
                    data-suite={suite.id}
                    aria-pressed={activeSuite === suite.id}
                    onClick={() => switchLibrarySuite(sessionKey, suite.id)}
                    className={`rounded-full px-2 py-0.5 ${activeSuite === suite.id ? 'bg-current/15 font-bold' : 'opacity-60 hover:opacity-100'}`}
                >
                    {t(suite.labelKey)}
                </button>
            ))}
        </div>
    );
};

export default DevLibraryRendererSwitch;
