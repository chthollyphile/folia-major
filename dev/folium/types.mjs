#!/usr/bin/env node
// dev/folium/types.mjs
// Generates mods/folium.d.ts, the editor hints for mod authors, from the public
// contract: src/mods/folium/contract.ts (the client entry) followed by
// src/mods/folium/mainContract.ts (the main entry). The contract imports nothing
// and is made of type declarations plus one constant; the main contract imports
// only types of the contract, which the type file holds itself. So the type file
// is the same text with that constant turned into a declaration and that import
// left out: no compiler is needed, and the result imports nothing either. A
// mod's entries point at it with a JSDoc type and get completion and the
// contract's own comments, with no build step:
//
//   /** @param {import('../folium').FoliumClientApi} folium */
//   export default function activate(folium) { ... }
//
//   node dev/folium/types.mjs           write mods/folium.d.ts
//   node dev/folium/types.mjs --check   exit 1 when the file is out of date
//
// test/unit/mod-system/foliumAuthorTools.test.ts runs the check, so a contract
// change without regenerating the type file fails the unit tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_PATH, MAIN_CONTRACT_PATH } from './api-docs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TYPES_PATH = path.join(ROOT, 'mods', 'folium.d.ts');

const HEADER = `// mods/folium.d.ts
// 本文件由 \`npm run folium:types\` 从 src/mods/folium/contract.ts 和 mainContract.ts 生成，请勿手动修改。
//
// 给模组作者的编辑器提示：Folium 的全部公开类型，不引用任何别的文件。在模组的入口里用 JSDoc 指到它，
// 编辑器就有补全和每个成员的说明，不需要构建。client 入口：
//
//   /** @param {import('../folium').FoliumClientApi} folium */
//   export default function activate(folium) { ... }
//
// main 入口：
//
//   /** @param {import('../folium').FoliumMainApi} api */
//   module.exports = function activate(api) { ... };
//
// 模组不在本仓库的 mods/ 目录里时，把这个文件拷到模组文件夹的旁边（不要放进模组文件夹里面：
// 里面的每个文件都算模组的内容），路径改成拷过去的位置。这个文件只给编辑器看，宿主不读它。
`;

/* A contract's own header comment (everything before its first declaration or JSDoc) is about the source file. */
const dropFileHeader = (text) => text.slice(text.search(/^(\/\*\*|export )/m));

// The one import the main contract may have: types of the contract, which the type file holds itself.
const CONTRACT_TYPES_IMPORT = /^import type \{[^}]*\} from '\.\/contract';\r?\n/m;

/**
 * The type file as text, from the texts of the contract and the main contract. Throws when either has
 * something a type file cannot hold.
 */
export const renderFoliumTypes = (contractText, mainContractText = '') => {
    if (/^import\s/m.test(contractText)) {
        throw new Error('contract.ts must import nothing: the type file is made from it alone');
    }
    const mainText = mainContractText.replace(CONTRACT_TYPES_IMPORT, '');
    if (/^import\s/m.test(mainText)) {
        throw new Error('mainContract.ts may import only types of ./contract: the type file is made from the two alone');
    }
    const texts = [contractText, mainText].filter((text) => text.trim() !== '').map(dropFileHeader);
    // The one runtime value: `export const NAME = Object.freeze({ a: 1, b: 2 });` becomes its declaration.
    const body = texts.join('\n').replace(
        /^export const (\w+) = Object\.freeze\(\{([^}]*)\}\);$/gm,
        (_match, name, members) => {
            // A comma at the end, or one member to a line, leaves an empty piece: not a member.
            const parts = members.split(',').map((member) => member.trim()).filter(Boolean);
            const odd = parts.find((member) => !/^\w+: [\w.'"-]+$/.test(member));
            if (odd !== undefined) {
                throw new Error(`contract.ts: "${odd}" in ${name} is not a plain "name: value" member, which is all the type file can hold`);
            }
            return `export declare const ${name}: { ${parts.map((member) => `readonly ${member}`).join('; ')} };`;
        },
    );
    const leftover = /^export (?!interface |type |declare const )\w+ \w+/m.exec(body);
    if (leftover) {
        throw new Error(`contract.ts has a declaration the type file cannot hold: "${leftover[0]}"`);
    }
    return `${HEADER}\n${body.trimEnd()}\n`;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const next = renderFoliumTypes(fs.readFileSync(CONTRACT_PATH, 'utf8'), fs.readFileSync(MAIN_CONTRACT_PATH, 'utf8'));
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(TYPES_PATH) ? fs.readFileSync(TYPES_PATH, 'utf8') : '';
        if (current !== next) {
            console.error('mods/folium.d.ts is out of date: run `npm run folium:types`');
            process.exit(1);
        }
        console.log('mods/folium.d.ts is up to date');
    } else {
        fs.writeFileSync(TYPES_PATH, next);
        console.log(`wrote ${path.relative(ROOT, TYPES_PATH)}`);
    }
}
