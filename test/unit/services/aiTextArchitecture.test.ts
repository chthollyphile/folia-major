import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// test/unit/services/aiTextArchitecture.test.ts
// The window reaches the AI text services through one file, src/services/aiText.ts. This reads
// every source file under src/ and fails when another file names what only that one should know:
// our web routes for the AI asks, the desktop bridge's methods for them, a service's address, or
// the name of a stored AI setting.
//
// In src/ it does not look for model names or for the service ids 'gemini' and 'openai'. Outside
// src/ it reads only the two main-process files named at the end; shared/, worker/, api-ts/, api/
// and deploy/ are not looked at.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DOOR = 'src/services/aiText.ts';

const NAMES = {
    route: /\/api\/(?:generate-theme|segment-lyrics)/,
    bridge: /\b(?:generateTheme|segmentLyrics|testAiConnection|listAiModels)\b/,
    address: /generativelanguage\.googleapis\.com|api\.openai\.com|api\.deepseek\.com|api\.anthropic\.com|moonshot\.(?:cn|ai)|bigmodel\.cn|api\.z\.ai|dashscope|tencent(?:cloud)?maas|xiaomimimo/,
    setting: /\b(?:GEMINI|OPENAI)_API_\w+|\b(?:VITE_)?AI_PROVIDER\b/i,
};
type Kind = keyof typeof NAMES;

// Files other than the door that may name some of these, and why.
const ALLOWED: Record<string, Kind[]> = {
    // Declares the bridge's methods for TypeScript.
    'src/vite-env.d.ts': ['bridge'],
    // Reads which service the web deployment chose (the build's VITE_AI_PROVIDER).
    'src/services/runtimeConfig.ts': ['setting'],
    // The settings form: it shows and stores the AI settings under their stored names, and shows
    // an example address as a placeholder.
    'src/components/modal/SettingsModal.tsx': ['setting'],
    // The type of the form's state, which the dialog hands to the page that draws the form.
    'src/components/modal/settings/pages/settingsPageContext.ts': ['setting'],
    'src/components/modal/settings/pages/ai/AiProviderSettings.tsx': ['setting'],
    // Upstream's endpoint check for a stored AI key (is the key still meant for this address).
    'src/utils/openAIEndpoint.ts': ['setting', 'address'],
    // Upstream's wall tools ask the bridge for a theme directly; to move behind services/aiText.
    'src/components/app/wall-tools/useAppWallToolsHost.ts': ['bridge'],
    'src/components/wall/useWallToolsCommonActions.ts': ['bridge'],
    'src/components/wall/wallToolsHost.ts': ['bridge'],
};

const collectSourceFiles = async (relativeDir: string): Promise<string[]> => {
    const entries = await readdir(path.join(repoRoot, relativeDir), { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
        const relativePath = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) return collectSourceFiles(relativePath);
        return /\.(ts|tsx)$/.test(entry.name) ? [relativePath] : [];
    }));
    return files.flat();
};

const kindsNamedIn = (source: string): Kind[] => (
    (Object.keys(NAMES) as Kind[]).filter(kind => NAMES[kind].test(source))
);

describe('AI text services in the window', () => {
    it('names the routes, the bridge, the addresses and the stored settings only in the door', async () => {
        const files = (await collectSourceFiles('src')).filter(file => file !== DOOR);
        const sources = await Promise.all(files.map(file => readFile(path.join(repoRoot, file), 'utf8')));

        const violations = files.flatMap((file, index) => (
            kindsNamedIn(sources[index])
                .filter(kind => !(ALLOWED[file] ?? []).includes(kind))
                .map(kind => `${file} names an AI ${kind}`)
        ));

        expect(violations).toEqual([]);
    }, 30_000);

    it('finds those names in the door itself, so the patterns above still match something', async () => {
        const door = await readFile(path.join(repoRoot, DOOR), 'utf8');

        expect(kindsNamedIn(door)).toEqual(['route', 'bridge', 'setting']);
    });
});

// The main process sends the requests itself, from electron/aiTextClient.cjs, with the hosts and
// models of each provider written in its adapter under shared/ai/. The two files that carry an ask
// to it (the IPC handlers in main.cjs, the bridge in preload.cjs) must not write what the client
// and the adapters write today: three of their hosts, a model of three families, Gemini's key
// header or one of the two key settings. This is a list of the names in use, not a rule: another host,
// another model family or a Bearer header would pass. The two files still read which service is
// chosen (AI_PROVIDER) and the user's address (OPENAI_API_URL); this does not look for those, nor
// at any other file under electron/.
describe('AI text services in the main process', () => {
    const SERVICE_DETAIL = /generativelanguage\.googleapis\.com|api\.openai\.com|api\.deepseek\.com|gemini-\d|gpt-\d|deepseek-v\d|x-goog-api-key|(?:GEMINI|OPENAI)_API_KEY/i;

    it.each(['electron/main.cjs', 'electron/preload.cjs'])('%s names none of the client\'s hosts, models, key header or key settings', async (file) => {
        const source = await readFile(path.join(repoRoot, file), 'utf8');

        expect(source.match(SERVICE_DETAIL)?.[0]).toBeUndefined();
    });

    it('finds those names in the client and the adapters, so the pattern still matches something', async () => {
        const adapters = (await readdir(path.join(repoRoot, 'shared/ai'))).filter(name => name.endsWith('.mjs'));
        const sources = await Promise.all(['electron/aiTextClient.cjs', ...adapters.map(name => `shared/ai/${name}`)]
            .map(file => readFile(path.join(repoRoot, file), 'utf8')));
        const named = sources.join('\n');

        expect(named).toMatch(SERVICE_DETAIL);
        for (const detail of ['api.openai.com', 'api.deepseek.com', 'generativelanguage.googleapis.com', 'gpt-5', 'gemini-3', 'deepseek-v4', 'x-goog-api-key', 'OPENAI_API_KEY']) {
            expect(named).toContain(detail);
        }
    });
});
