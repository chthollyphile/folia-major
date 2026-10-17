import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTED_PLATFORMS, countPlatformNames, totalOf } from './platformNameCount.ts';
import { PLATFORM_NAME_PLACES } from './platformNamePlaces.ts';

// test/unit/onlineMusic/omniArchitecture.test.ts

const roots = ['src/components', 'src/hooks', 'src/stores'];
const forbiddenImport = /from\s+['"][^'"]*(providerRegistry|kugouTransport|qqTransport|bodianTransport|ytmTransport|spotifyTransport|sodaTransport|onlineMusic\/netease\/netease)['"]/;

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

    // One platform's rule stays with the platform. Every line outside a platform's own folders
    // that names it is counted; the list says how many each file may hold and why they stay.
    it('lets no file outside a platform folder name a platform more often than the list says', () => {
        const { places } = countPlatformNames();
        const differences: string[] = [];
        for (const file of new Set([...places.keys(), ...Object.keys(PLATFORM_NAME_PLACES)])) {
            for (const platform of COUNTED_PLATFORMS) {
                const counted = totalOf(places.get(file)?.[platform]);
                const listed = PLATFORM_NAME_PLACES[file]?.n[platform] ?? 0;
                if (counted > listed) differences.push(`${file} names ${platform} on ${counted} lines, the list allows ${listed}: the rule belongs in the platform's own folder`);
                if (counted < listed) differences.push(`${file} names ${platform} on ${counted} lines, the list still says ${listed}: lower it (platformNameCount.ts --lower)`);
            }
        }
        expect(differences).toEqual([]);
    });
});
