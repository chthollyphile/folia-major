import dynamicIconImports from 'lucide-react/dynamicIconImports';
import type { FoliumIconOptions } from './contract';

// src/mods/folium/icons.ts
// `folium.ui.icon`: the host's lucide icon set, handed to mods as plain SVG elements.
// Mods have no React, so they get the icon's node data drawn into a fresh <svg> instead of the
// lucide-react component. Every call returns a new element built from immutable data, so there is
// no shared state for a mod to change. Each icon's module loads on first use (one small chunk per
// icon, kept out of the PWA precache by vite.config.ts).

type IconNode = Array<[tag: string, attributes: Record<string, string>]>;
type IconModule = { __iconData?: { node?: IconNode } };

const SVG_NS = 'http://www.w3.org/2000/svg';
const loaders = dynamicIconImports as unknown as Record<string, () => Promise<IconModule>>;

/** True when `name` is a lucide icon name (kebab-case, as listed on lucide.dev). */
export const hasFoliumIcon = (name: string): boolean => Object.hasOwn(loaders, name);

const positive = (value: unknown, fallback: number) => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

/** Draws lucide node data into a new <svg>, with lucide's default attributes. */
export const buildIconElement = (name: string, node: IconNode, options: FoliumIconOptions = {}): SVGSVGElement => {
    const size = positive(options.size, 24);
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attributes: Record<string, string> = {
        xmlns: SVG_NS,
        width: String(size),
        height: String(size),
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: typeof options.color === 'string' && options.color ? options.color : 'currentColor',
        'stroke-width': String(positive(options.strokeWidth, 2)),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        class: `lucide lucide-${name}`,
        'aria-hidden': 'true',
    };
    Object.entries(attributes).forEach(([key, value]) => svg.setAttribute(key, value));
    node.forEach(([tag, childAttributes]) => {
        const child = document.createElementNS(SVG_NS, tag);
        Object.entries(childAttributes).forEach(([key, value]) => {
            // `key` is React's list key in lucide's data, not an SVG attribute.
            if (key !== 'key') child.setAttribute(key, String(value));
        });
        svg.appendChild(child);
    });
    return svg;
};

/** The icon as a new <svg>, or null when `name` is not a lucide icon. */
export const createFoliumIcon = async (name: string, options?: FoliumIconOptions): Promise<SVGSVGElement | null> => {
    if (typeof name !== 'string' || !hasFoliumIcon(name)) return null;
    const node = (await loaders[name]()).__iconData?.node;
    return node ? buildIconElement(name, node, options) : null;
};
