import { useMemo, useRef } from 'react';
import type { Theme } from '@/types';
import type { FoliumPanelContext } from '../contract';
import { toFoliumTheme } from '../dto';
import type { FoliumHostContext } from '../helpers';
import { useFoliumListeners, useFoliumNotifyOnChange } from '../../runtime/listeners';

// src/mods/folium/registries/useFoliumPanelContext.ts
// Theme and locale context shared by owned panel tabs and full home pages.

export const useFoliumPanelContext = (theme: Theme, isDaylight: boolean, locale: string): FoliumHostContext<FoliumPanelContext> => {
    const themeRef = useRef({ theme, isDaylight });
    themeRef.current = { theme, isDaylight };
    const listeners = useFoliumListeners('panel subscriber');
    const ctx = useMemo<FoliumHostContext<FoliumPanelContext>>(() => Object.freeze({
        locale,
        getTheme: () => toFoliumTheme(themeRef.current.theme, themeRef.current.isDaylight),
        subscribe: listeners.subscribe,
    }), [locale]);
    useFoliumNotifyOnChange(listeners, [theme, isDaylight]);
    return ctx;
};
