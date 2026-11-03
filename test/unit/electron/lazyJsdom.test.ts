import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// test/unit/electron/lazyJsdom.test.ts

const require = createRequire(import.meta.url);
const { deferJsdom } = require('../../../electron/netease/lazyJsdom.cjs') as {
    deferJsdom: (resolveFrom: string) => boolean;
};

const folders: string[] = [];

// A package folder with a file of its own and, unless told otherwise, a stand-in for the real jsdom
// in its node_modules that counts how often it was loaded.
const createPackage = ({ withJsdom = true } = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-lazy-jsdom-'));
    folders.push(root);
    const packageFile = path.join(root, 'util', 'request.js');
    fs.mkdirSync(path.dirname(packageFile), { recursive: true });
    fs.writeFileSync(packageFile, 'module.exports = {};\n');
    const counter = `__lazyJsdomLoads_${folders.length}_${Date.now()}`;
    if (withJsdom) {
        const jsdomDir = path.join(root, 'node_modules', 'jsdom');
        fs.mkdirSync(jsdomDir, { recursive: true });
        fs.writeFileSync(path.join(jsdomDir, 'index.js'), [
            `globalThis[${JSON.stringify(counter)}] = (globalThis[${JSON.stringify(counter)}] || 0) + 1;`,
            'class JSDOM { constructor(html) { this.html = html; } static fragment(text) { return `fragment:${text}`; } }',
            'class VirtualConsole { on() { return this; } }',
            'module.exports = { JSDOM, VirtualConsole, CookieJar: class CookieJar {} };',
        ].join('\n'));
    }
    return {
        packageFile,
        packageRequire: createRequire(packageFile),
        loads: () => ((globalThis as Record<string, unknown>)[counter] as number | undefined) ?? 0,
    };
};

afterEach(() => {
    folders.splice(0).forEach((folder) => fs.rmSync(folder, { recursive: true, force: true }));
});

describe('deferred jsdom', () => {
    it('hands the package its two classes without loading jsdom', () => {
        const { packageFile, packageRequire, loads } = createPackage();

        expect(deferJsdom(packageFile)).toBe(true);
        const { JSDOM, VirtualConsole } = packageRequire('jsdom');

        expect(typeof JSDOM).toBe('function');
        expect(typeof VirtualConsole).toBe('function');
        expect(loads()).toBe(0);
    });

    it('loads the real jsdom once, on the first construction, and builds real instances', () => {
        const { packageFile, packageRequire, loads } = createPackage();
        deferJsdom(packageFile);
        const { JSDOM, VirtualConsole } = packageRequire('jsdom');

        const virtualConsole = new VirtualConsole();
        const dom = new JSDOM('<p>hello</p>');

        expect(loads()).toBe(1);
        expect(dom.html).toBe('<p>hello</p>');
        expect(virtualConsole.on()).toBe(virtualConsole);
        // After the first use the cache holds the real module, and the classes handed out earlier
        // still stand for the real ones.
        const real = packageRequire('jsdom');
        expect(dom.constructor).toBe(real.JSDOM);
        expect(dom instanceof JSDOM).toBe(true);
        expect(JSDOM.fragment('x')).toBe('fragment:x');
        expect(loads()).toBe(1);
    });

    it('lets a subclass of a deferred class build objects of its own', () => {
        const { packageFile, packageRequire } = createPackage();
        deferJsdom(packageFile);
        const { JSDOM } = packageRequire('jsdom') as { JSDOM: new (html: string) => { html: string } };

        class Page extends JSDOM {
            describe() {
                return `page:${this.html}`;
            }
        }
        const page = new Page('<p>hello</p>');

        expect(page.describe()).toBe('page:<p>hello</p>');
        expect(page instanceof Page).toBe(true);
        expect(page instanceof packageRequire('jsdom').JSDOM).toBe(true);
    });

    it('loads the real jsdom at once when another export is asked for', () => {
        const { packageFile, packageRequire, loads } = createPackage();
        deferJsdom(packageFile);

        const { CookieJar } = packageRequire('jsdom');

        expect(loads()).toBe(1);
        expect(new CookieJar().constructor.name).toBe('CookieJar');
    });

    it('lists the exports of the real jsdom', () => {
        const { packageFile, packageRequire } = createPackage();
        deferJsdom(packageFile);

        expect(Object.keys(packageRequire('jsdom')).sort()).toEqual(['CookieJar', 'JSDOM', 'VirtualConsole']);
    });

    it('leaves a jsdom that is already loaded alone', () => {
        const { packageFile, packageRequire, loads } = createPackage();
        const real = packageRequire('jsdom');

        expect(deferJsdom(packageFile)).toBe(false);
        expect(packageRequire('jsdom')).toBe(real);
        expect(loads()).toBe(1);
    });

    it('does nothing when the package has no jsdom to load', () => {
        const { packageFile } = createPackage({ withJsdom: false });
        // The repository's own jsdom is found from the temp folder's parents on no machine: the
        // temp folder is outside the repository.
        expect(deferJsdom(packageFile)).toBe(false);
    });
});
