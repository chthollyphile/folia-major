import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/onlineMusic/omniArchitecture.test.ts

const roots = ['src/components', 'src/hooks', 'src/stores'];
const forbiddenImport = /from\s+['"][^'"]*(providerRegistry|kugouTransport|services\/netease)['"]/;

const collectSourceFiles = async (path: string): Promise<string[]> => {
    const entry = await stat(path);
    if (entry.isFile()) return /\.(ts|tsx)$/.test(path) ? [path] : [];
    const { readdir } = await import('node:fs/promises');
    const children = await readdir(path);
    return (await Promise.all(children.map(child => collectSourceFiles(join(path, child))))).flat();
};

describe('Omni architecture boundaries', () => {
    it('prevents ordinary UI and state layers from importing provider internals', async () => {
        const files = (await Promise.all(roots.map(collectSourceFiles))).flat();
        const violations: string[] = [];
        for (const file of files) {
            const source = await readFile(file, 'utf8');
            if (forbiddenImport.test(source)) violations.push(file);
        }
        expect(violations).toEqual([]);
    });

    it('keeps deleted legacy pages out of the source tree', async () => {
        const legacyFiles = [
            'src/components/Home.tsx',
            'src/components/LocalMusicView.tsx',
            'src/components/local/LocalPlaylistView.tsx',
            'src/components/local/LocalArtistView.tsx',
            'src/components/navidrome/NavidromeMusicView.tsx',
            'src/components/navidrome/NavidromeCollectionView.tsx',
            'src/components/navidrome/NavidromeAlbumView.tsx',
            'src/components/navidrome/NavidromeArtistView.tsx',
        ];
        await expect(Promise.all(legacyFiles.map(file => stat(file)))).rejects.toThrow();
    });
});
