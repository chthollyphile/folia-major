import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FoliumHomeNavigation } from '../../../mods/folium/HomePageMount';
import { homePagesRegistry } from '../../../mods/folium/homePages';
import { homePageActiveElement } from '../../../mods/folium/homePageKeyboard';
import { useFoliumRegistryEntries } from '../../../mods/folium/registry';
import { closeBravaisHomePopover } from './bravaisHomeUiStore';

// src/library/suites/bravais/useBravaisHomeNavigation.tsx
// A single live mount moves between the shortcuts column and its overflow menu.
// Its column width stays fixed even in the wider menu, so the fit measurement cannot oscillate.
export function useBravaisHomeNavigation(shortcutsMeasureRef: RefObject<HTMLDivElement | null>) {
    const entries = useFoliumRegistryEntries(homePagesRegistry);
    const [host] = useState(() => document.createElement('div'));
    const measureRef = useRef(host);
    const [column, setColumn] = useState<HTMLDivElement | null>(null);
    const columnRef = useRef<HTMLDivElement | null>(null);
    const attachColumn = useCallback((node: HTMLDivElement | null) => { columnRef.current = node; setColumn(node); }, []);
    const [menu, setMenu] = useState<HTMLDivElement | null>(null);
    const inColumn = useRef(true);
    const focused = useRef<HTMLElement | null>(null);
    const restoreMenuFocus = useCallback(() => {
        columnRef.current?.closest('[data-bravais-home-seam]')?.querySelector<HTMLButtonElement>('[data-bravais-seam-action="more"]')?.focus({ preventScroll: true });
        closeBravaisHomePopover('menu');
    }, []);
    const beforeOpen = useCallback(() => { if (!inColumn.current) restoreMenuFocus(); }, [restoreMenuFocus]);

    useLayoutEffect(() => {
        if (!column) return;
        const shortcuts = shortcutsMeasureRef.current;
        const measureWidth = () => {
            host.style.width = `${column.clientWidth}px`;
            // The native measurement copy also exists while shortcuts are in the overflow menu.
            const width = shortcuts?.getBoundingClientRect().width || column.clientWidth;
            host.style.setProperty('--folium-home-shortcut-width', `${width}px`);
        };
        measureWidth();
        const observer = new ResizeObserver(measureWidth);
        observer.observe(column);
        if (shortcuts) observer.observe(shortcuts);
        return () => observer.disconnect();
    }, [column, host, shortcutsMeasureRef]);
    useLayoutEffect(() => () => { host.remove(); }, [host]);

    // Native DOM bubbling sees the real destination, even though this portal's React parent stays put.
    useLayoutEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || inColumn.current || !menu || event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            restoreMenuFocus();
        };
        const onFocus = () => { focused.current = homePageActiveElement() as HTMLElement | null; };
        const onBlur = (event: FocusEvent) => { if (event.relatedTarget) focused.current = null; };
        host.addEventListener('keydown', onKeyDown);
        host.addEventListener('focusin', onFocus);
        host.addEventListener('focusout', onBlur);
        return () => {
            host.removeEventListener('keydown', onKeyDown);
            host.removeEventListener('focusin', onFocus);
            host.removeEventListener('focusout', onBlur);
        };
    }, [host, menu, restoreMenuFocus]);

    const hasEntries = entries.length > 0;
    const columnGap = hasEntries ? 2 : 0;
    const place = (showInColumn: boolean) => {
        inColumn.current = showInColumn;
        return {
            column: hasEntries ? <div ref={attachColumn} className="bravais-home-mod-shortcuts" style={{ paddingTop: showInColumn ? columnGap : 0 }} /> : null,
            menu: hasEntries && !showInColumn ? <div ref={setMenu} /> : null,
            mount: hasEntries && column ? createPortal(<FoliumHomeNavigation surface="bravais" onOpen={beforeOpen} />, host) : null,
        };
    };
    // Run after each commit: refs may acquire a new menu, but never remount the mod for placement changes.
    useLayoutEffect(() => {
        if (!column) { host.remove(); return; }
        const visible = inColumn.current || Boolean(menu);
        const target = inColumn.current ? column : menu ?? column;
        const active = homePageActiveElement();
        // React may detach the menu slot before this layout effect. Preserve focus across that move too.
        const previous = !host.isConnected && active === document.body ? focused.current : null;
        const restore = active instanceof HTMLElement && host.contains(document.activeElement) ? active : previous;
        host.style.position = visible ? 'relative' : 'absolute';
        host.style.visibility = visible ? '' : 'hidden';
        host.inert = !visible;
        host.setAttribute('aria-hidden', String(!visible));
        if (host.parentNode !== target) {
            target.append(host);
            if (restore && visible) restore.focus({ preventScroll: true });
        }
        if (restore && !visible) restoreMenuFocus();
    });
    return { measureRef, columnGap, place };
}
