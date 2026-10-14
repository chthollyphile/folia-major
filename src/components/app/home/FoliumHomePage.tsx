import { useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { HomePageMount } from '../../../mods/folium/HomePageMount';
import { closeHomePage, homePagesRegistry, useHomePageStore } from '../../../mods/folium/homePages';
import { useFoliumRegistryEntries } from '../../../mods/folium/registry';
import { resolveFoliumLabel } from '../../../mods/folium/params';
import { useSearchNavigationStore } from '../../../stores/useSearchNavigationStore';
import { homePageActiveElement, homePageFocusTargets, isHomePaletteShortcut } from '../../../mods/folium/homePageKeyboard';

// src/components/app/home/FoliumHomePage.tsx
// A mod page covers the library without changing native source selection or remounting the library.

export function FoliumHomePage({ theme }: { theme: Theme }) {
    const { t, i18n } = useTranslation();
    const entries = useFoliumRegistryEntries(homePagesRegistry);
    const activeId = useHomePageStore(state => state.activeId);
    const entry = entries.find(candidate => candidate.id === activeId);
    const backRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!entry) return;
        const previous = homePageActiveElement();
        const page = backRef.current?.closest('section');
        backRef.current?.focus({ preventScroll: true });
        return () => {
            // Do not steal focus from a command palette or another window opened over this page.
            if (previous instanceof HTMLElement && previous.isConnected
                && (document.activeElement === document.body || page?.contains(document.activeElement))) {
                previous.focus({ preventScroll: true });
            }
        };
    }, [entry]);
    useEffect(() => useSearchNavigationStore.subscribe((state, previous) => {
        if (state.homeViewTab !== previous.homeViewTab) closeHomePage();
    }), []);
    if (!entry) return null;
    return <section data-folium-home-page={entry.id} data-folia-keyboard-window="true"
        aria-label={resolveFoliumLabel(entry.def.label, i18n.language, entry.name)}
        className="absolute inset-0 z-[60] flex min-h-0 flex-col overflow-hidden pointer-events-auto"
        style={{ backgroundColor: theme.backgroundColor, color: theme.primaryColor }}
        onKeyDown={event => {
            // Preserve the global command palette shortcut while mod inputs own ordinary keys.
            const key = event.nativeEvent;
            if (isHomePaletteShortcut(key)) return;
            if (!event.defaultPrevented && key.key === 'Tab' && !key.ctrlKey && !key.altKey && !key.metaKey) {
                const targets = homePageFocusTargets(event.currentTarget);
                const current = key.composedPath()[0];
                const index = targets.indexOf(current as HTMLElement);
                if (targets.length && (index < 0 || (key.shiftKey ? index === 0 : index === targets.length - 1))) {
                    event.preventDefault();
                    targets[key.shiftKey ? targets.length - 1 : 0].focus();
                }
            }
            event.stopPropagation();
        }}>
        <header className="flex shrink-0 items-center px-4 py-3 md:px-8 border-b border-current/10">
            <button ref={backRef} type="button" onClick={closeHomePage} title={t('home.backToHome')}
                aria-label={t('home.backToHome')} className="rounded-full p-2 hover:bg-current/10">
                <ChevronLeft size={20} />
            </button>
        </header>
        <div className="flex-1 min-h-0 overflow-auto"><HomePageMount key={entry.id} entry={entry} surface="page" /></div>
    </section>;
}
