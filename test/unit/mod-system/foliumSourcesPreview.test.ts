// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SharedModule from '@/mods/folium/shared';
import type * as ReactI18next from 'react-i18next';

// test/unit/mod-system/foliumSourcesPreview.test.ts
// Folium 2.0 (plan §10, delivery): until the nine built-in sources use it, the source interface is a preview.
// While foliumShared.json says `sourcesPreview`, the generated reference and type file say so over the source
// interface and nowhere else (folium 1's frozen interface is not touched), and the mod panel marks third-party
// `folium: 2` source mods, not built-in copies or ordinary mods.

const flags = vi.hoisted(() => ({ preview: true }));

vi.mock('@/mods/folium/shared', async (importOriginal) => ({
    ...(await importOriginal<typeof SharedModule>()),
    get FOLIUM_SOURCES_PREVIEW() {
        return flags.preview;
    },
}));

vi.mock('@/mods/useModsStore', () => ({
    useModsStore: { getState: () => ({ getModStorageUsage: vi.fn(), clearModCache: vi.fn() }) },
    modSettingsRowId: (modId: string) => `mod:${modId}`,
}));

vi.mock('@/mods/manager/ModSurfaceRenderer', () => ({
    ModSurfaceRenderer: () => null,
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof ReactI18next>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));

import fs from 'fs';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Theme } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';
import { ModListItem } from '@/mods/manager/ModListItem';
import { modManagerClassesFor } from '@/mods/manager/modManagerClasses';
import enLocale from '@/i18n/locales/en';
import zhLocale from '@/i18n/locales/zh-CN';
import inLocale from '@/i18n/locales/in';
import viLocale from '@/i18n/locales/vi';
import {
    CONTRACT_PATH,
    MAIN_CONTRACT_PATH,
    renderApiDocs,
    SHARED_PATH,
    SOURCES_PREVIEW_NOTE,
} from '../../../dev/folium/api-docs.mjs';
import { renderFoliumTypes } from '../../../dev/folium/types.mjs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shared = JSON.parse(fs.readFileSync(SHARED_PATH, 'utf8')) as { sourcesPreview?: unknown };
const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
const mainContract = fs.readFileSync(MAIN_CONTRACT_PATH, 'utf8');

/* The reference split at its `## ` headings: the text before the first one, then each section by its title. */
const sectionsOf = (markdown: string) => {
    const parts = markdown.split(/^## /m);
    return {
        top: parts[0],
        sections: new Map(parts.slice(1).map((part) => [part.slice(0, part.indexOf('\n')).trim(), part])),
    };
};

describe('the source interface is marked as a preview in the generated docs', () => {
    it('is a preview while the nine built-in sources are not all mods', () => {
        expect(shared.sourcesPreview).toBe(true);
    });

    it('says so at the top of the reference and over the two source sections, nowhere else', () => {
        const { top, sections } = sectionsOf(renderApiDocs(contract, mainContract));
        expect(top).toContain(SOURCES_PREVIEW_NOTE);
        expect(SOURCES_PREVIEW_NOTE).toContain('预览');
        const marked = [...sections].filter(([, text]) => text.includes(SOURCES_PREVIEW_NOTE)).map(([title]) => title);
        expect(marked).toEqual(['音源（Folium 2）', '音源类模组的 main 入口']);
        // folium 1's frozen interface (the client entry and the main entry shared with ordinary mods) is not marked.
        expect(sections.get('客户端入口')).not.toContain('预览版');
        expect(sections.get('main 入口（Node）')).not.toContain('预览版');
    });

    it('says so in the type file header and under the two source section markers only', () => {
        const types = renderFoliumTypes(contract, mainContract);
        const header = types.slice(0, types.indexOf('export declare const FOLIUM_VERSION'));
        expect(header).toContain('// 预览：Folium 2 的音源接口');
        const markersFollowedByNote = [...types.matchAll(/^\/\/ -{8,} (.+)\n\/\/ 预览：/gm)].map((match) => match[1]);
        expect(markersFollowedByNote).toEqual(['Sources', 'Source main API']);
        expect(types.match(/\/\/ 预览：/g)).toHaveLength(3);
    });
});

describe('the mod panel marks third-party source mods as a preview', () => {
    const classes = modManagerClassesFor(false);
    let root: Root | null = null;
    let host: HTMLDivElement;

    const modInfo = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
        id: 'radio',
        name: 'Radio',
        version: '1.0.0',
        author: null,
        description: null,
        permissions: [],
        status: 'loaded',
        error: null,
        enabled: true,
        trustStale: false,
        signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
        devSource: false,
        experimental: [],
        embedOrigins: [],
        folia: null,
        hasMain: true,
        clientUrl: null,
        loadOrder: null,
        folium: 2,
        tier: 'user',
        kind: 'source',
        ...overrides,
    });

    const renderRow = async (mod: ModRuntimeInfo, expanded = false) => {
        await act(async () => {
            root!.render(React.createElement(ModListItem, {
                mod,
                expanded,
                selected: false,
                selectionMode: false,
                isLast: true,
                isDaylight: false,
                theme: { secondaryColor: '#888888' } as Theme,
                classes,
                onToggleExpand: () => {},
                onToggleEnabled: () => {},
                onToggleSelected: () => {},
                onNotice: () => {},
            }));
        });
    };

    const mark = () => host.querySelector('[data-mod-preview-mark]');
    const detail = () => host.querySelector('[data-mod-preview-detail]');

    beforeEach(() => {
        flags.preview = true;
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
        document.body.replaceChildren();
    });

    it('marks an unsigned third-party folium 2 source mod, with the reason in its title and expanded row', async () => {
        await renderRow(modInfo(), true);
        expect(mark()?.textContent).toBe('mods.sourcePreview');
        expect(mark()?.getAttribute('title')).toBe('mods.sourcePreviewDetail');
        expect(detail()?.textContent).toContain('mods.sourcePreviewDetail');
    });

    it('marks a signed third-party source mod too', async () => {
        await renderRow(modInfo({ signature: { status: 'verified', reason: null, keyId: 'k', keyLabel: null, signedAt: null } }));
        expect(mark()).not.toBeNull();
    });

    it('leaves a built-in copy unmarked', async () => {
        await renderRow(modInfo({
            tier: 'builtin',
            signature: { status: 'builtin', reason: null, keyId: null, keyLabel: null, signedAt: null },
        }), true);
        expect(mark()).toBeNull();
        expect(detail()).toBeNull();
    });

    it('leaves ordinary mods unmarked, folium 1 and folium 2 alike', async () => {
        await renderRow(modInfo({ folium: 1, kind: 'standard' }), true);
        expect(mark()).toBeNull();
        expect(detail()).toBeNull();
        await renderRow(modInfo({ kind: 'standard' }), true);
        expect(mark()).toBeNull();
    });

    it('drops the mark once the source interface is no longer a preview', async () => {
        flags.preview = false;
        await renderRow(modInfo(), true);
        expect(mark()).toBeNull();
        expect(detail()).toBeNull();
    });

    it('has the mark and its reason in all four host locales', () => {
        for (const locale of [enLocale, zhLocale, inLocale, viLocale]) {
            const mods = (locale as unknown as { mods: Record<string, unknown> }).mods;
            expect(typeof mods.sourcePreview).toBe('string');
            expect(typeof mods.sourcePreviewDetail).toBe('string');
        }
    });
});
