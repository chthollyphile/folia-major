import fs from 'fs';
import { describe, expect, it } from 'vitest';
import enLocale from '@/i18n/locales/en';
import zhLocale from '@/i18n/locales/zh-CN';
import inLocale from '@/i18n/locales/in';
import viLocale from '@/i18n/locales/vi';
import { CONTRACT_PATH, MAIN_CONTRACT_PATH, renderApiDocs, SHARED_PATH } from '../../../dev/folium/api-docs.mjs';
import { renderFoliumTypes } from '../../../dev/folium/types.mjs';

// test/unit/mod-system/foliumSourcesStable.test.ts
// Folium 2.0 (plan §10, delivery): the source interface (`folium.sources` and the main entry's source `api`) was a
// preview while the built-in sources moved onto it, marked by foliumShared.json's `sourcesPreview`. The mark came off
// before edge went into main: the generated reference and type file no longer say "preview" over it, the mod panel
// has no preview mark for source mods, and D513 holds its two sections to "add, never change" like the rest.

const shared = JSON.parse(fs.readFileSync(SHARED_PATH, 'utf8')) as Record<string, unknown>;
const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
const mainContract = fs.readFileSync(MAIN_CONTRACT_PATH, 'utf8');

describe('the source interface is no longer a preview', () => {
    it('has no preview flag in the shared file', () => {
        expect(shared).not.toHaveProperty('sourcesPreview');
    });

    it('says nothing about a preview in the generated reference', () => {
        const docs = renderApiDocs(contract, mainContract);
        expect(docs).not.toContain('> **预览**');
        expect(docs).not.toContain('预览版');
    });

    it('says nothing about a preview in the generated type file', () => {
        const types = renderFoliumTypes(contract, mainContract);
        expect(types).not.toMatch(/^\/\/ 预览：/m);
        // Both source sections are still there, now under the stable rules.
        expect(types).toMatch(/^\/\/ -{8,} Sources$/m);
        expect(types).toMatch(/^\/\/ -{8,} Source main API$/m);
    });

    it('drops the mod panel\'s preview mark from all four host locales', () => {
        for (const locale of [enLocale, zhLocale, inLocale, viLocale]) {
            const mods = (locale as unknown as { mods: Record<string, unknown> }).mods;
            expect(mods).not.toHaveProperty('sourcePreview');
            expect(mods).not.toHaveProperty('sourcePreviewDetail');
        }
    });
});
