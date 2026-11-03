import type { IconNode, LucideIcon } from 'lucide-react';

// src/services/lucideIconResolver.ts
// Resolves a theme's lyricsIcons entry (a PascalCase lucide name coming from AI output or the
// theme editor) to a renderable component, so callers never index lucide-react by hand.
// Icons load on demand through lucide's dynamicIconImports - one small chunk per icon, the same
// chunks folium.ui.icon uses - instead of `import * as` the whole set, which made every lucide icon
// a startup dependency. Lookups stay synchronous over what has loaded; loadLucideIcons (or the
// useLucideIcons hook) fetches the rest and announces each arrival to subscribers.

type IconLoader = () => Promise<{ default?: unknown }>;

interface IconTable {
    loaders: Record<string, IconLoader>;
    /** Exact export name (`Star`, `StarIcon`, `LucideStar`) -> dynamicIconImports key. */
    keysByName: Map<string, string>;
    /** Lower-cased export name -> canonical export name, for the case-insensitive theme lists. */
    namesByLowercase: Map<string, string>;
}

export type LucideIconStatus = 'loading' | 'ready' | 'missing';

let table: IconTable | null = null;
let tablePromise: Promise<IconTable> | null = null;
let tableFailed = false;
const loadedIcons = new Map<string, LucideIcon>();
const pendingIcons = new Map<string, Promise<void>>();
const failedIcons = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;

// lucide icons are forwardRef objects; requiring that shape keeps a module that is not an icon
// from passing as one.
const isLucideIcon = (value: unknown): value is LucideIcon => (
    typeof value === 'object' && value !== null && '$$typeof' in value && 'render' in value
);

// lucide-react names each export after its kebab-case file: `arrow-down-0-1` -> `ArrowDown01`.
const toPascalCase = (key: string) => key.replace(/(?:^|-)(\w)/g, (_, char: string) => char.toUpperCase());

/** Builds the name tables lucide-react's barrel exports, from the keys of its dynamicIconImports map. */
const buildIconTable = (loaders: Record<string, IconLoader>): IconTable => {
    const keysByName = new Map<string, string>();
    const namesByLowercase = new Map<string, string>();
    const keys = Object.keys(loaders);
    // Every icon is exported as `Name`, `NameIcon` and `LucideName`. Plain names go in first so an
    // icon's own name always wins over another icon's suffixed or prefixed alias.
    [(name: string) => name, (name: string) => `${name}Icon`, (name: string) => `Lucide${name}`].forEach(form => {
        keys.forEach(key => {
            const name = form(toPascalCase(key));
            if (keysByName.has(name)) return;
            keysByName.set(name, key);
            if (!namesByLowercase.has(name.toLowerCase())) namesByLowercase.set(name.toLowerCase(), name);
        });
    });
    return { loaders, keysByName, namesByLowercase };
};

const notify = () => {
    revision += 1;
    listeners.forEach(listener => listener());
};

/** Loads lucide's name -> loader map once; a failed load (offline) is retried by the next call. */
const loadIconTable = (): Promise<IconTable> => {
    tablePromise ??= import('lucide-react/dynamicIconImports')
        .then(module => {
            table = buildIconTable(module.default as unknown as Record<string, IconLoader>);
            tableFailed = false;
            notify();
            return table;
        })
        .catch(error => {
            tablePromise = null;
            tableFailed = true;
            notify();
            throw error;
        });
    return tablePromise;
};

const loadIconModule = (icons: IconTable, key: string): Promise<void> => {
    if (loadedIcons.has(key)) return Promise.resolve();
    let pending = pendingIcons.get(key);
    if (!pending) {
        pending = icons.loaders[key]()
            .then(module => {
                if (!isLucideIcon(module.default)) return;
                loadedIcons.set(key, module.default);
                failedIcons.delete(key);
                notify();
            })
            .catch(() => {
                // Offline with the chunk not cached: report the icon as missing until a later call retries.
                failedIcons.add(key);
                notify();
            })
            .finally(() => pendingIcons.delete(key));
        pendingIcons.set(key, pending);
    }
    return pending;
};

const trimName = (name: unknown) => (typeof name === 'string' ? name.trim() : '');

/**
 * Loads the named icons so the synchronous lookups below can return them. Names match
 * case-insensitively; unknown names are skipped. Settles once every icon has loaded or failed.
 */
export const loadLucideIcons = async (names: readonly unknown[] | undefined): Promise<void> => {
    const requested = (names ?? []).map(trimName).filter(Boolean);
    if (requested.length === 0) return;
    let icons: IconTable;
    try {
        icons = await loadIconTable();
    } catch {
        return;
    }
    await Promise.all(requested.map(name => {
        const canonical = icons.keysByName.has(name) ? name : icons.namesByLowercase.get(name.toLowerCase());
        const key = canonical ? icons.keysByName.get(canonical) : undefined;
        return key ? loadIconModule(icons, key) : undefined;
    }));
};

/** Whether `name` is a lucide export name (case-sensitive), for editor validation. */
export const hasLucideIcon = async (name: string): Promise<boolean> => {
    const trimmed = trimName(name);
    if (!trimmed) return false;
    try {
        return (await loadIconTable()).keysByName.has(trimmed);
    } catch {
        return false;
    }
};

/** The icon component for an exact export name, or null when it is unknown or not loaded yet. */
export const resolveLucideIcon = (name: string | null | undefined): LucideIcon | null => {
    const key = table?.keysByName.get(trimName(name));
    return key ? loadedIcons.get(key) ?? null : null;
};

/**
 * The icon's SVG node data (lucide's IconNode: [tag, attrs, children?][]) for an exact export name,
 * or null when it is unknown or not loaded yet. For canvas / Pixi renderers that draw the shapes
 * themselves (lumiere's line art, hanabi's icon stickers).
 *
 * 取 lucide-react 图标组件里的 IconNode：组件是 forwardRef，它的 render 只是
 * createElement(Icon, { iconNode, ... })（1.48 起是 { icon: { node, ... } }），不跑 hooks，直接调用即可拿到节点数据，
 * 不必渲染 SVG 再解析。
 */
export const resolveLucideIconNode = (name: string | null | undefined): IconNode | null => {
    const icon = resolveLucideIcon(name) as unknown as { render?: (props: object, ref: null) => unknown } | null;
    if (!icon || typeof icon.render !== 'function') return null;
    try {
        const element = icon.render({}, null) as { props?: { iconNode?: unknown; icon?: { node?: unknown } } } | null;
        const node = element?.props?.iconNode ?? element?.props?.icon?.node;
        return Array.isArray(node) ? node as IconNode : null;
    } catch {
        return null;
    }
};

/**
 * Where an exact export name stands: `loading` until its chunk (or the name table) has arrived,
 * `missing` for names lucide does not have or chunks that failed to load. Lets a renderer hold a
 * placeholder instead of flashing its fallback for an icon that is about to appear.
 */
export const getLucideIconStatus = (name: string | null | undefined): LucideIconStatus => {
    const trimmed = trimName(name);
    if (!trimmed) return 'missing';
    if (!table) return tableFailed ? 'missing' : 'loading';
    const key = table.keysByName.get(trimmed);
    if (!key) return 'missing';
    if (loadedIcons.has(key)) return 'ready';
    return failedIcons.has(key) ? 'missing' : 'loading';
};

/**
 * Resolves a theme's lyricsIcons list to canonical lucide export names: case-insensitive, deduplicated,
 * unknown and not-yet-loaded names dropped. No fallback - callers that want a default icon add it
 * themselves. Call loadLucideIcons first.
 */
export const resolveLucideIconNames = (names: readonly string[] | undefined): string[] => [
    ...new Set((names ?? [])
        .map(name => (typeof name === 'string' ? table?.namesByLowercase.get(name.trim().toLowerCase()) : undefined))
        .filter((name): name is string => name !== undefined && resolveLucideIcon(name) !== null)),
];

/** Subscribes to icon arrivals (useSyncExternalStore shape). */
export const subscribeLucideIcons = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** Bumps every time an icon (or the name table) finishes loading or fails. */
export const getLucideIconRevision = () => revision;
