import { describe, expect, it } from 'vitest';
import fs from 'fs';
import {
    CONTRACT_PATH,
    MAIN_CONTRACT_PATH,
    MAIN_ENTRY_SECTION,
    OUTPUT_PATH,
    parseContract as parseContractJs,
    renderApiDocs,
} from '../../../dev/folium/api-docs.mjs';

// test/unit/mod-system/foliumApiDocs.test.ts
// docs/folium/api.md is generated from src/mods/folium/contract.ts and
// src/mods/folium/mainContract.ts. These pin
// that the reference is current (a contract change must come with
// `npm run folium:api`), that every exported type is in it, that every
// public declaration and member carries a description, and that types land
// under the entry (client or main) that actually hands them out.

interface ParsedItem {
    name: string;
    doc: string;
    header?: string;
    source?: string;
    members?: { name: string; doc: string; type: string; children?: { name: string; doc: string }[] }[];
}
const parseContract = (text: string) => parseContractJs(text) as unknown as { title: string; items: ParsedItem[] }[];

const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
const mainContract = fs.readFileSync(MAIN_CONTRACT_PATH, 'utf8');
const contracts = [contract, mainContract];

/* Folium type names an item's signature mentions (header, member types, or type source). */
const signatureNames = (item: ParsedItem) => {
    const text = [item.header ?? '', item.source ?? '', ...(item.members ?? []).map((member) => member.type)].join(' ');
    return text.match(/\bFolium[A-Z]\w*/g) ?? [];
};

describe('Folium API reference', () => {
    it('is up to date with the contract (run `npm run folium:api`)', () => {
        expect(fs.readFileSync(OUTPUT_PATH, 'utf8')).toBe(renderApiDocs(contract, mainContract));
    });

    it('covers every exported declaration', () => {
        const exported = contracts.flatMap((text) => [...text.matchAll(/^export (?:interface|type|const) (\w+)/gm)].map((match) => match[1])).sort();
        const documented = contracts.flatMap((text) => parseContract(text)).flatMap((section) => section.items.map((item) => item.name)).sort();
        expect(documented).toEqual(exported);
    });

    it('describes every declaration and member', () => {
        const missing: string[] = [];
        for (const section of contracts.flatMap((text) => parseContract(text))) {
            for (const item of section.items) {
                if (!item.doc) missing.push(item.name);
                for (const member of item.members ?? []) {
                    if (!member.doc) missing.push(`${item.name}.${member.name}`);
                    // The members of an inline object type (FoliumOmniProviderInfo's `supports`) too.
                    for (const child of member.children ?? []) {
                        if (!child.doc) missing.push(`${item.name}.${member.name}.${child.name}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });

    // The client entry section promises that everything in it comes from `activate(folium)`.
    it('files under the client entry only types that activate(folium) reaches', () => {
        const sections = parseContract(contract);
        const byName = new Map(sections.flatMap((section) => section.items).map((item) => [item.name, item]));
        const reachable = new Set<string>();
        const pending = ['FoliumClientModule'];
        while (pending.length > 0) {
            const name = pending.pop()!;
            const item = byName.get(name);
            if (!item || reachable.has(name)) continue;
            reachable.add(name);
            pending.push(...signatureNames(item));
        }
        const client = sections.find((section) => section.title === 'Client API');
        expect(client?.items.length).toBeGreaterThan(0);
        expect(client!.items.map((item) => item.name).filter((name) => !reachable.has(name))).toEqual([]);
    });

    // Main-entry types live in mainContract.ts; none of the client contract's sections may claim one.
    it('lists main-entry-only types under the main entry heading, linked from its contents line', () => {
        const mainEntry = parseContract(mainContract).find((section) => section.title === MAIN_ENTRY_SECTION)?.items ?? [];
        expect(mainEntry.map((item) => item.name)).toContain('FoliumModPaths');

        const misplaced = parseContract(contract)
            .flatMap((section) => section.items)
            .filter((item) => /main entr(?:y|ies) only/i.test(item.doc) || item.name === 'FoliumModPaths')
            .map((item) => item.name);
        expect(misplaced).toEqual([]);

        const docs = renderApiDocs(contract, mainContract);
        const chapter = docs.indexOf('\n## main 入口（Node）\n');
        expect(chapter).toBeGreaterThan(-1);
        const toc = docs.split('\n').find((line) => line.startsWith('- **main 入口（Node）**'));
        const clientToc = docs.split('\n').find((line) => line.startsWith('- **客户端入口**'));
        for (const { name } of mainEntry) {
            const anchor = `(#${name.toLowerCase()})`;
            const heading = docs.indexOf(`\n### ${name}\n`);
            expect(heading, name).toBeGreaterThan(chapter);
            expect(docs.indexOf(`\n### ${name}\n`, heading + 1), name).toBe(-1);
            expect(docs.slice(chapter, heading), `${name} linked from the main entry table`).toContain(anchor);
            expect(toc, name).toContain(anchor);
            expect(clientToc, name).not.toContain(anchor);
        }
    });
});
