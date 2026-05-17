import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

const readRepoFile = async (relativePath: string) => {
    return readFile(path.join(repoRoot, relativePath), 'utf8');
};

const collectSourceFiles = async (relativeDir: string): Promise<string[]> => {
    const absoluteDir = path.join(repoRoot, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
        const relativePath = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
            return collectSourceFiles(relativePath);
        }

        return [relativePath];
    }));

    return files.flat();
};

describe('lyrics architecture', () => {
    it('keeps Netease call sites on the shared processing helper', async () => {
        const callSites = [
            'src/hooks/useLibraryPlaybackController.ts',
            'src/hooks/useSessionRestoreController.ts',
            'src/services/prefetchService.ts',
            'src/services/onlinePlayback.ts',
            'src/services/localMusicService.ts',
            'src/components/modal/LyricMatchModal.tsx',
            'src/components/modal/NaviLyricMatchModal.tsx'
        ];

        for (const file of callSites) {
            const content = await readRepoFile(file);
            expect(content, `${file} should use shared Netease processing`).toContain('processNeteaseLyrics');
            expect(content, `${file} should not import legacy parsers`).not.toMatch(/lrcParser|yrcParser/);
            expect(content, `${file} should not inline chorus detection`).not.toContain('detectChorusLines');
        }
    });

    it('does not allow functional source files to import legacy parser wrappers directly', async () => {
        const allowedFiles = new Set([
            'src/utils/lrcParser.ts',
            'src/utils/yrcParser.ts'
        ]);
        const sourceFiles = (await collectSourceFiles('src'))
            .filter(file => /\.(ts|tsx)$/.test(file));

        const offenders: string[] = [];
        for (const file of sourceFiles) {
            if (allowedFiles.has(file.replace(/\\/g, '/'))) {
                continue;
            }

            const content = await readRepoFile(file);
            if (/from ['"].*(?:lrcParser|yrcParser)['"]/.test(content)) {
                offenders.push(file.replace(/\\/g, '/'));
            }
        }

        expect(offenders).toEqual([]);
    });

    it('keeps worker and compatibility wrappers wired to parserCore', async () => {
        const workerContent = await readRepoFile('src/workers/lyricsParser.worker.ts');
        const lrcWrapperContent = await readRepoFile('src/utils/lrcParser.ts');
        const yrcWrapperContent = await readRepoFile('src/utils/yrcParser.ts');

        expect(workerContent).toContain('parseLyricsByFormat');
        expect(workerContent).not.toContain('buildTimedWords');
        expect(lrcWrapperContent).toContain('parseCoreLRC');
        expect(yrcWrapperContent).toContain('parseCoreYRC');
    });
});
