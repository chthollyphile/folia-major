// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SkipForward } from 'lucide-react';
import fs from 'node:fs';
import path from 'node:path';
import { buildIconElement, createFoliumIcon, hasFoliumIcon } from '@/mods/folium/icons';

// test/unit/mod-system/foliumIcons.test.ts
// folium.ui.icon: lucide icons for mods as plain, mod-owned SVG elements.

const shapesOf = (svg: Element) => Array.from(svg.children).map(child => [
    child.tagName.toLowerCase(),
    Object.fromEntries(Array.from(child.attributes).map(attribute => [attribute.name, attribute.value])),
]);

describe('folium.ui.icon', () => {
    it('names the lucide version Folia bundles in its contract text, so authors look up the right icon list', () => {
        const contract = fs.readFileSync(path.join(process.cwd(), 'src/mods/folium/contract.ts'), 'utf8');
        const bundled = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules/lucide-react/package.json'), 'utf8')).version as string;
        const [major, minor] = bundled.split('.');
        expect(contract).toContain(`lucide-react ${major}.${minor}, the version Folia bundles`);
    });

    it('draws the same shapes as the host lucide component', async () => {
        const icon = await createFoliumIcon('skip-forward');
        expect(icon).not.toBeNull();
        const host = document.createElement('div');
        host.innerHTML = renderToStaticMarkup(createElement(SkipForward));
        expect(shapesOf(icon!)).toEqual(shapesOf(host.firstElementChild!));
        expect(icon!.getAttribute('class')).toBe('lucide lucide-skip-forward');
        expect(icon!.getAttribute('stroke')).toBe('currentColor');
    });

    it('applies size, stroke width and color', async () => {
        const icon = await createFoliumIcon('play', { size: 16, strokeWidth: 1.5, color: '#ff0000' });
        expect(icon!.getAttribute('width')).toBe('16');
        expect(icon!.getAttribute('height')).toBe('16');
        expect(icon!.getAttribute('stroke-width')).toBe('1.5');
        expect(icon!.getAttribute('stroke')).toBe('#ff0000');
        expect(icon!.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    it('draws an alias name as its canonical icon', async () => {
        // lucide's alias files (icons/alarm-check.mjs) only re-export `default`, with no __iconData.
        // dynamicIconImports routes alias keys to the canonical module instead; this pins that.
        const alias = await createFoliumIcon('alarm-check');
        const canonical = await createFoliumIcon('alarm-clock-check');
        expect(alias).not.toBeNull();
        expect(shapesOf(alias!)).toEqual(shapesOf(canonical!));
        expect(alias!.getAttribute('class')).toBe('lucide lucide-alarm-check');
    });

    it('returns null for unknown or malformed names', async () => {
        expect(hasFoliumIcon('play')).toBe(true);
        expect(hasFoliumIcon('not-an-icon')).toBe(false);
        expect(hasFoliumIcon('constructor')).toBe(false);
        await expect(createFoliumIcon('not-an-icon')).resolves.toBeNull();
        await expect(createFoliumIcon(42 as unknown as string)).resolves.toBeNull();
    });

    it('hands out a new element on every call', async () => {
        const first = await createFoliumIcon('play');
        const second = await createFoliumIcon('play');
        expect(first).not.toBe(second);
        first!.setAttribute('stroke', 'red');
        expect(second!.getAttribute('stroke')).toBe('currentColor');
    });

    it('ignores invalid sizes', () => {
        const icon = buildIconElement('dot', [['circle', { cx: '12', cy: '12', r: '1', key: 'a' }]], { size: -4, strokeWidth: Number.NaN });
        expect(icon.getAttribute('width')).toBe('24');
        expect(icon.getAttribute('stroke-width')).toBe('2');
        expect(icon.firstElementChild!.hasAttribute('key')).toBe(false);
    });
});
