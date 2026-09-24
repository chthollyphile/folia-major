import type { FoliumStyleDef } from '../contract';
import { createFoliumRegistry } from '../registry';

// src/mods/folium/registries/styles.ts
// `folium.registries.styles`: mod CSS for the host page. Each entry becomes one
// <style> element wrapped in `@layer folium-mods`. The layer is declared after
// Tailwind's layers, so mod rules beat host utilities without !important, while
// the cascade stays predictable (registration order inside the layer). Removing
// the entry — or disabling the mod — removes the element.
//
// The only stable targets are the public parts (`[data-folium-part="…"]`); the
// host does not police selectors, but anything else can change in any release.

const MAX_CSS_LENGTH = 64 * 1024;
const elements = new Map<string, HTMLStyleElement>();

export const stylesRegistry = createFoliumRegistry<FoliumStyleDef>('styles', {
    validate: (def) => {
        if (typeof def.css !== 'string') {
            throw new Error('styles.register: css must be a string');
        }
        if (def.css.length > MAX_CSS_LENGTH) {
            throw new Error(`styles.register: css is limited to ${MAX_CSS_LENGTH} characters`);
        }
        return def;
    },
    onAdd: (entry) => {
        if (typeof document === 'undefined') return;
        const element = document.createElement('style');
        element.dataset.foliumStyle = entry.id;
        element.textContent = `@layer folium-mods {\n${entry.def.css}\n}`;
        document.head.appendChild(element);
        elements.set(entry.id, element);
    },
    onRemove: (entry) => {
        elements.get(entry.id)?.remove();
        elements.delete(entry.id);
    },
});
