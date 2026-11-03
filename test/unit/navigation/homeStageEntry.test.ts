import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { PlayerState, type Theme } from '@/types';
import { buildHomeModel } from '@/components/app/home/buildHomeModel';
import type { LibraryAccountController } from '@/library/core/account/account.contract';

// test/unit/navigation/homeStageEntry.test.ts

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

const theme: Theme = {
    name: 'Test',
    backgroundColor: '#000',
    primaryColor: '#fff',
    secondaryColor: '#999',
    accentColor: '#fff',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

const readRepoFile = async (relativePath: string) => {
    return readFile(path.join(repoRoot, relativePath), 'utf8');
};

const createBaseParams = () => {
    const openStagePlayer = vi.fn().mockResolvedValue(undefined);

    return {
        account: {} as LibraryAccountController,
        playSong: vi.fn(),
        navigateToPlayer: vi.fn(),
        navigateToLattice: vi.fn(),
        togglePlayback: vi.fn(),
        enterPlaybackView: vi.fn(),
        refreshOnlineProviderPlaylists: vi.fn().mockResolvedValue(undefined),
        user: null,
        playlists: [],
        cloudPlaylist: undefined,
        currentSong: null,
        playerState: PlayerState.PAUSED,
        handlePlaylistSelect: vi.fn(),
        handleAlbumSelect: vi.fn(),
        handleArtistSelect: vi.fn(),
        focusedPlaylistIndex: 0,
        setFocusedPlaylistIndex: vi.fn(),
        focusedFavoriteAlbumIndex: 0,
        setFocusedFavoriteAlbumIndex: vi.fn(),
        focusedRadioIndex: 0,
        setFocusedRadioIndex: vi.fn(),
        openSettings: vi.fn(),
        navigateToSearch: vi.fn(),
        openLocalAlbumByName: vi.fn(),
        openLocalArtistByName: vi.fn(),
        localSongs: [],
        localLibraryCatalog: {
            entities: [],
            assignments: [],
            ready: true,
            failed: false,
            reload: vi.fn().mockResolvedValue(undefined),
        },
        localPlaylists: [],
        onRefreshLocalSongs: vi.fn(),
        onPlayLocalSong: vi.fn(),
        onAddLocalSongToQueue: vi.fn(),
        localMusicState: 'idle' as any,
        setLocalMusicState: vi.fn(),
        onMatchSong: vi.fn(),
        onPlayNavidromeSong: vi.fn(),
        onAddNavidromeSongsToQueue: vi.fn(),
        onMatchNavidromeSong: vi.fn(),
        navidromeFocusedAlbumIndex: 0,
        setNavidromeFocusedAlbumIndex: vi.fn(),
        stageSource: 'stage-api' as const,
        activePlaybackContext: 'stage' as const,
        openStagePlayer,
        stageStatus: null,
        setStageStatus: vi.fn(),
        leaveStagePlayback: vi.fn(),
        clearStagePlaybackSession: vi.fn(),
        clearPersistedStagePlaybackCache: vi.fn().mockResolvedValue(undefined),
        loadStageSessionIntoPlayback: vi.fn().mockResolvedValue(undefined),
        theme,
        navidromeEnabled: false,
        playAll: vi.fn(),
        addAllToQueue: vi.fn(),
        addSongToQueue: vi.fn(),
        onOpenCollection: vi.fn(),
        onPushCollection: vi.fn(),
        onPopCollectionTo: vi.fn(),
        onBackCollection: vi.fn(),
    };
};

describe('home stage entry wiring', () => {
    it('exposes stage entry props through the Home view model', async () => {
        const params = createBaseParams();
        const model = buildHomeModel(params);

        expect(model.surfaceProps.stageEnabled).toBe(true);
        expect(model.surfaceProps.stageIsActive).toBe(true);

        await model.surfaceProps.onOpenStagePlayer?.();
        expect(params.openStagePlayer).toHaveBeenCalledTimes(1);
    });

    it('disables the stage entry when no stage source is available', () => {
        const params = createBaseParams();
        const model = buildHomeModel({
            ...params,
            stageSource: undefined,
            activePlaybackContext: 'main',
        });

        expect(model.surfaceProps.stageEnabled).toBe(false);
        expect(model.surfaceProps.stageIsActive).toBe(false);
    });
});

describe('home stage entry source contracts', () => {
    it('keeps the app-level home surface forwarding legacy props into Grid3D', async () => {
        // R3 起 Home 经 Library registry 解析首页 surface（`<Grid3D` 不再写在 Home 里）；含义不变：
        // Home 把首页模型的 surfaceProps 与宿主的 openGridView 交给首页 surface，而默认 suite 的首页就是 Grid3D。
        const content = await readRepoFile('src/components/app/Home.tsx');

        expect(content).toContain("resolveLibrarySurface('home'");
        expect(content).toContain('<HomeSurface');
        expect(content).toContain('{...model.surfaceProps}');
        expect(content).toContain('onOpenGridView={openGridView}');

        const gridEntry = await readRepoFile('src/library/suites/grid/entry.ts');
        expect(gridEntry).toContain("import Grid3D from './home/Grid3D';");
        expect(gridEntry).toContain('home: { component: Grid3D');
    });

    it('keeps the Grid3D desktop tabs rendering the stage entry button', async () => {
        const content = await readRepoFile('src/library/suites/grid/home/Grid3D.tsx');

        expect(content).toContain('stageEnabled?: boolean;');
        expect(content).toContain('onOpenStagePlayer?: () => void;');
        expect(content).toContain('{stageEnabled && (');
        expect(content).toContain("onClick={() => onOpenStagePlayer?.()}");
        expect(content).toContain("t('home.stage')");
    });
});
