import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import type { FoliumHomeTabDef } from '../../../mods/folium/contract';
import type { FoliumRegistryEntry } from '../../../mods/runtime/registry';
import type { LibraryHomeExtraTab } from '../../../library/core/suite/suite.contract';
import type { LibraryHomeData } from '../../../library/core/home/home.contract';
import type { LibraryAccountController } from '../../../library/core/account/account.contract';
import { useLibraryHomeSources } from '../../../library/core/home/useLibraryHomeSources';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { FoliumMountHost } from '../../../mods/runtime/FoliumMountHost';
import { toFoliumTheme } from '../../../mods/folium/dto';
import { closeFoliumHomeTab } from '../../../mods/folium/registries/homeTabs';
import { useFoliumPanelContext } from '../../../mods/folium/registries/useFoliumPanelContext';
import { resolveFoliumLabel } from '../../../mods/params/params';
import { isCommandPaletteShortcut, isTextEntryTarget } from '../../../utils/keyboardTargets';
import { useLibraryHomeSurfaceStore } from '../../../library/core/home/useLibraryHomeSurfaceStore';
import { selectNativeHomeTabFromPage } from './useFoliumHomeNavigation';
import {
    claimHomePageFocus,
    deepActiveElement,
    focusHomePageEdge,
    resolveHomePageGuardEdge,
    type HomePageFocusGuard,
} from './foliumHomePageFocus';

// src/components/app/home/FoliumHomePage.tsx
// The host provides a full-page box and native navigation; the mod owns only its ShadowRoot.
// 只在有页面开着时挂载：原生页签（useLibraryHomeSources）、日夜间这些订阅都在这里，Home 外壳不常驻订阅它们。
// 页面盖住整个首页（z-[60]）：页面开着时 Home 把原生首页那一层设成 inert 并自成层叠上下文（isolate），集合层
// （GridView / GridMap / TUI 的 z-[110]）、过渡背板 z-[49]、宿主对话框都只在那一层里比高低，整层压在页面下面；
// 就地渲染的登录弹窗（LibraryAccountHost，z-[100]）不在那一层里，仍在页面之上。顶上让出自绘标题栏的拖拽区（pt-8，与 TUI 首页一致）。
// 焦点：打开时交给当前页签；页内 Tab 顺序交给浏览器，首尾各一个守卫，焦点落到守卫上才绕回另一头（见 foliumHomePageFocus）；
// 关闭时还给打开它的那个元素。
// 打开时不从设置、命令面板这些接管键盘的窗口里抢焦点（claimHomePageFocus）；bravais 的 F6 在页面里经首页 surface 的
// 页签句柄接着循环。显式打开集合、首页 surface 不在时命令面板选原生页签，都会从外面关掉页面（foliumHomePageDismissal）。

/** 页面里的 F6 / Shift+F6（不带 Ctrl、Alt、Meta，不是按住重复，不在输入框里）：往后 / 往前切首页页签，与 bravais 墙上同一对键。 */
const resolveHomePageCycleKey = (event: KeyboardEvent): 1 | -1 | null => {
    if (event.key !== 'F6' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
    if (isTextEntryTarget(event.composedPath()[0] ?? event.target)) return null;
    return event.shiftKey ? -1 : 1;
};

type FoliumHomePageProps = {
    entry: FoliumRegistryEntry<FoliumHomeTabDef>;
    extraTabs: readonly LibraryHomeExtraTab[];
    /** 原生页签条的数据来源（与首页 surface 同一套 core 绑定）。 */
    account: LibraryAccountController;
    surfaceProps: Pick<LibraryHomeData, 'theme' | 'user' | 'playlists' | 'cloudPlaylist' | 'navidromeEnabled'>;
};

export function FoliumHomePage({ entry, extraTabs, account, surfaceProps }: FoliumHomePageProps) {
    const { t, i18n } = useTranslation();
    const { theme, user, playlists, cloudPlaylist, navidromeEnabled } = surfaceProps;
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const nativeSources = useLibraryHomeSources({ account, user, playlists, cloudPlaylist, navidromeEnabled });
    const ctx = useFoliumPanelContext(theme, isDaylight, i18n.language);
    const foliumTheme = useMemo(() => toFoliumTheme(theme, isDaylight), [theme, isDaylight]);
    const label = resolveFoliumLabel(entry.def.label, i18n.language, entry.name);
    const sectionRef = useRef<HTMLElement>(null);
    const activeTabRef = useRef<HTMLButtonElement>(null);
    // 打开页面的那个元素。在渲染时取：提交之后原生首页变成 inert，浏览器会把焦点从它上面挪走。
    // 页面在几个模组页之间切换时不卸载，这个元素一直是最初打开页面的那一个。
    const [opener] = useState(deepActiveElement);

    // 打开时把焦点交给当前页签，但不从设置、命令面板这些窗口里抢（页面那时开在它们下面）：等它们关掉、焦点空出来再交。
    useEffect(() => {
        const page = sectionRef.current;
        return page ? claimHomePageFocus(page, () => activeTabRef.current) : undefined;
    }, [entry.id]);
    useEffect(() => {
        const page = sectionRef.current;
        return () => {
            // 不抢别人的焦点：命令面板或别的窗口开在页面上面时焦点在它们那里，只在焦点随页面消失（落到 body）
            // 或还留在页面里时才还回去。卸载时原生首页的 inert 已经在同一次提交里撤掉。
            const active = document.activeElement;
            const lostWithPage = !active || active === document.body || Boolean(page?.contains(active));
            if (lostWithPage && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
                opener.focus({ preventScroll: true });
            }
        };
    }, [opener]);

    // 首尾守卫（属性名即 HOME_PAGE_FOCUS_GUARD）：浏览器的 Tab 把焦点送到这里，说明焦点要离开页面了；
    // 模组自己 preventDefault 的 Tab 不挪焦点，也就走不到这里。
    const focusGuard = (guard: HomePageFocusGuard) => <span tabIndex={0} data-folium-focus-guard={guard}
        className="sr-only" onFocus={event => {
            const page = sectionRef.current;
            if (page) focusHomePageEdge(page, resolveHomePageGuardEdge(guard, event.relatedTarget, page), event.currentTarget);
        }} />;

    return <section ref={sectionRef} data-folium-home-page={entry.id} data-folia-keyboard-window="true"
        aria-label={label} className="absolute inset-0 z-[60] flex min-h-0 flex-col overflow-hidden pt-8 pointer-events-auto"
        style={{ backgroundColor: theme.backgroundColor, color: theme.primaryColor }}
        onKeyDown={event => {
            // Keep the host's explicit global palette entry reachable, including from a ShadowRoot input.
            if (isCommandPaletteShortcut(event.nativeEvent)) return;
            event.stopPropagation();
            // 首页自己的页签循环键（bravais 的 F6）：页面开着时墙的按键监听让出，这里经首页 surface 的页签句柄接着循环——
            // 切到下一个模组页面，或绕回原生页签（随之关掉页面）。模组自己 preventDefault 的、在输入框里按的不接，
            // 没有这个循环的 suite（网格、TUI）不接。
            const delta = resolveHomePageCycleKey(event.nativeEvent);
            if (delta && !event.defaultPrevented && useLibraryHomeSurfaceStore.getState().tabs?.cycleTab?.(delta)) event.preventDefault();
        }}>
        {focusGuard('start')}
        <header className="flex shrink-0 items-center gap-4 px-4 py-3 md:px-8 border-b border-current/10">
            <button type="button" onClick={closeFoliumHomeTab} title={t('mods.homeBackToLibrary')}
                aria-label={t('mods.homeBackToLibrary')} className="rounded-full p-2 hover:bg-current/10">
                <ChevronLeft size={20} />
            </button>
            <nav className="flex flex-1 flex-wrap items-center gap-1" aria-label={t('mods.homePageNavigation')}>
                {nativeSources.tabs.map(tab => <button key={tab.key} type="button" disabled={Boolean(tab.disabledReason)}
                    title={tab.disabledReason || tab.label} onClick={() => { selectNativeHomeTabFromPage(tab.key, nativeSources.setTab); }}
                    className="rounded-full px-3 py-1.5 text-sm opacity-70 hover:opacity-100 disabled:opacity-30">
                    {tab.label}
                </button>)}
                {extraTabs.map(tab => <button key={tab.id} type="button" aria-pressed={tab.active}
                    ref={tab.active ? activeTabRef : undefined}
                    onClick={tab.select} className={`rounded-full px-3 py-1.5 text-sm ${tab.active ? 'bg-current/10 font-semibold' : 'opacity-70 hover:opacity-100'}`}>
                    {tab.label}
                </button>)}
            </nav>
        </header>
        <FoliumMountHost key={entry.id} modId={entry.modId} where={`home tab ${entry.id}`}
            entryKind="home-tab" entryId={entry.id} mount={entry.def.mount} ctx={ctx} shadow fill
            theme={foliumTheme} className="flex-1 min-h-0 w-full overflow-auto" />
        {focusGuard('end')}
    </section>;
}
