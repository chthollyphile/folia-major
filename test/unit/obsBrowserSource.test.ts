import { describe, expect, it } from 'vitest';
import { DEFAULT_SONNET_TUNING, PlayerState } from '../../src/types';
import {
    buildObsBrowserSourceConfigSignature,
    buildObsBrowserSourceClock,
    buildLegacyObsBrowserSourceBackgroundConfig,
    downsampleObsSpectrum,
    ObsBrowserSourceConfigPublicationTracker,
    resolveMainWindowVisualizerMode,
    resolveObsBrowserSourceClockTime,
    resolveObsBrowserSourceCoverUrl,
    resolveObsBrowserSourceImageAsset,
    resolveObsBrowserSourceImageAssets,
} from '../../src/utils/obsBrowserSource';
import type { ObsBrowserSourceConfig } from '../../src/types/obsBrowserSource';
import { DEFAULT_THEME } from '../../src/services/baseThemes';

const buildObsConfig = (overrides: Partial<ObsBrowserSourceConfig> = {}): ObsBrowserSourceConfig => ({
    activePlaybackContext: 'main',
    stageSource: null,
    hasTrack: true,
    song: { id: 1, name: 'Song' },
    songArtist: 'Artist',
    songAlbum: 'Album',
    coverUrl: null,
    lyrics: {
        lines: [{ fullText: 'Line', startTime: 0, endTime: 1, words: [] }],
    },
    theme: DEFAULT_THEME,
    isDaylight: false,
    visualizerMode: 'sonnet',
    background: { mode: 'common', transparent: true },
    lyricsFontScale: 1,
    visualizerOpacity: 1,
    subtitleOverlayOpacity: 1,
    staticMode: false,
    hideTranslationSubtitle: false,
    seed: 'song-1',
    updatedAt: 1,
    ...overrides,
});

describe('resolveMainWindowVisualizerMode', () => {
    it('drops the main window to still while OBS renders and the animation is not kept', () => {
        expect(resolveMainWindowVisualizerMode('cadenza', true, false)).toBe('still');
    });

    it('keeps the chosen mode when the user opted to keep the main window animation', () => {
        expect(resolveMainWindowVisualizerMode('cadenza', true, true)).toBe('cadenza');
    });

    it('never changes the mode when no OBS client is rendering', () => {
        expect(resolveMainWindowVisualizerMode('cadenza', false, false)).toBe('cadenza');
        expect(resolveMainWindowVisualizerMode('cadenza', false, true)).toBe('cadenza');
    });
});

describe('obsBrowserSource utilities', () => {
    it('signs visual configuration semantically instead of by timestamp or object identity', () => {
        const first = buildObsConfig();
        const sameContent = buildObsConfig({
            background: { transparent: true, mode: 'common' },
            updatedAt: 2,
        });

        expect(buildObsBrowserSourceConfigSignature(sameContent))
            .toBe(buildObsBrowserSourceConfigSignature(first));
    });

    it('changes the OBS configuration signature for visual and playback-content changes', () => {
        const baseSignature = buildObsBrowserSourceConfigSignature(buildObsConfig());
        const variants = [
            buildObsConfig({ song: { id: 2, name: 'Other song' } }),
            buildObsConfig({ lyrics: { lines: [{ fullText: 'Other line', startTime: 0, endTime: 1, words: [] }] } }),
            buildObsConfig({ theme: { ...DEFAULT_THEME, primaryColor: '#ff0000' } }),
            buildObsConfig({ visualizerTunings: { sonnet: { ...DEFAULT_SONNET_TUNING, cameraIntensity: 0.5 } } }),
            buildObsConfig({ background: { mode: 'common', transparent: false } }),
            // Subtitle scale and the harmony toggles were published (or, for the harmony pair, not
            // published at all) without the config contract declaring them, so the OBS page had no
            // typed way to read them and silently rendered its own defaults. These overrides are typed
            // as Partial<ObsBrowserSourceConfig>, so dropping a field from the contract fails the
            // typecheck here, and the signature assertion pins that changing one still reaches OBS.
            buildObsConfig({ subtitleFontScale: 1.3 }),
            buildObsConfig({ showHarmonySubtitle: false }),
            buildObsConfig({ harmonySubtitleBackground: false }),
        ];

        variants.forEach(config => {
            expect(buildObsBrowserSourceConfigSignature(config)).not.toBe(baseSignature);
        });
    });

    // The signature memoises heavy nodes by identity and keeps a one-slot cache for long strings, so
    // republishing an unchanged inlined asset never re-reads megabytes of base64. These pin the two
    // ways that can go wrong: a stale cache hit, or a real difference being missed.
    const buildLargeDataUrl = (fill: string) => `data:image/png;base64,${fill.repeat(5000)}`;

    it('separates configs that differ only inside a large inlined asset', () => {
        const buildPortrait = (fill: string) => ({ id: 'portrait', name: 'portrait.png', url: buildLargeDataUrl(fill) });

        expect(buildObsBrowserSourceConfigSignature(buildObsConfig({ monetPortraitImage: buildPortrait('A') })))
            .not.toBe(buildObsBrowserSourceConfigSignature(buildObsConfig({ monetPortraitImage: buildPortrait('B') })));
    });

    it('signs equal inlined assets identically across distinct objects', () => {
        const buildPortrait = () => ({ id: 'portrait', name: 'portrait.png', url: buildLargeDataUrl('A') });

        expect(buildObsBrowserSourceConfigSignature(buildObsConfig({ monetPortraitImage: buildPortrait() })))
            .toBe(buildObsBrowserSourceConfigSignature(buildObsConfig({ monetPortraitImage: buildPortrait() })));
    });

    it('does not reuse a cached long-string signature when the cover alternates', () => {
        const first = buildObsBrowserSourceConfigSignature(buildObsConfig({ coverUrl: buildLargeDataUrl('A') }));
        const second = buildObsBrowserSourceConfigSignature(buildObsConfig({ coverUrl: buildLargeDataUrl('B') }));

        expect(second).not.toBe(first);
        expect(buildObsBrowserSourceConfigSignature(buildObsConfig({ coverUrl: buildLargeDataUrl('A') }))).toBe(first);
    });

    it('deduplicates pending and published configs and republishes after re-enabling OBS', () => {
        const tracker = new ObsBrowserSourceConfigPublicationTracker();
        const config = buildObsConfig();
        const first = tracker.prepare(true, config);

        expect(first).not.toBeNull();
        expect(tracker.prepare(true, { ...config, updatedAt: 2 })).toBeNull();
        tracker.markPublished(first!.signature);
        expect(tracker.prepare(true, { ...config, updatedAt: 3 })).toBeNull();
        expect(tracker.prepare(false, config)).toBeNull();
        expect(tracker.prepare(true, { ...config, updatedAt: 4 })).not.toBeNull();
    });

    it('keeps the pre-registry OBS background protocol in sync with nested config', () => {
        const customImage = {
            id: 'background',
            name: 'background.webp',
            url: 'data:image/webp;base64,Zm9saWE=',
        };
        const legacy = buildLegacyObsBrowserSourceBackgroundConfig({
            mode: 'sora',
            transparent: true,
            common: {
                opacity: 0.6,
                useCoverColorBg: true,
                disableGeometricBackground: true,
                disableVignette: true,
            },
            customImage,
            monet: {
                tuning: {
                    backgroundSource: 'uploaded-global',
                    backgroundLayout: 'full-overlay',
                    backgroundBlurPx: 6,
                    backgroundOverlayOpacity: 0.74,
                    backgroundGrayscale: 0,
                    backgroundSaturation: 1.05,
                    backgroundWash: 0.34,
                    backgroundHalfPaneOffsetX: 0,
                    backgroundWashColorMode: 'theme',
                    backgroundWashCustomColor: '#8fb7ff',
                    backgroundDriftEnabled: true,
                    backgroundDriftStrength: 0.5,
                    backgroundStreaksEnabled: true,
                },
            },
            url: {
                items: [{ id: 'page', url: 'https://example.com', note: 'Example' }],
                selectedId: 'page',
            },
        });

        expect(legacy).toMatchObject({
            visualizerBackgroundMode: 'sora',
            backgroundOpacity: 0.6,
            transparentBackground: true,
            useCoverColorBg: true,
            disableGeometricBackground: true,
            disableVignette: true,
            monetBackgroundImage: customImage,
            urlBackgroundSelectedId: 'page',
        });
        expect(legacy.monetBackgroundTuning?.backgroundSource).toBe('uploaded-global');
        expect(legacy.urlBackgroundList).toEqual([
            { id: 'page', url: 'https://example.com', note: 'Example' },
        ]);
    });

    it('does not overwrite the manual offset when publishing a preview-adjusted clock', () => {
        const original = {
            currentTime: 2, duration: 30, playerState: PlayerState.PLAYING,
            sentAtMs: 1000, playbackRate: 1, lyricOffsetMs: 500,
        };
        const published = buildObsBrowserSourceClock(original, 30000);
        expect(original.lyricOffsetMs).toBe(500);
        expect(published.lyricOffsetMs).toBe(-29500);
        expect(resolveObsBrowserSourceClockTime(published, 1000)).toBe(31.5);
        // The seek detector converts this back to media time before comparing with currentTime.
        expect(resolveObsBrowserSourceClockTime(published, 2000) + published.lyricOffsetMs! / 1000).toBe(3);
        expect(buildObsBrowserSourceClock(original, 0)).toEqual(original);
    });

    it('extrapolates playing clock snapshots', () => {
        expect(resolveObsBrowserSourceClockTime({
            currentTime: 10,
            duration: 60,
            playerState: PlayerState.PLAYING,
            playbackRate: 1,
            sentAtMs: 1_000,
        }, 3_500)).toBe(12.5);
    });

    it('clamps extrapolated time to duration', () => {
        expect(resolveObsBrowserSourceClockTime({
            currentTime: 59,
            duration: 60,
            playerState: PlayerState.PLAYING,
            playbackRate: 1,
            sentAtMs: 1_000,
        }, 5_000)).toBe(60);
    });

    it('does not extrapolate paused snapshots', () => {
        expect(resolveObsBrowserSourceClockTime({
            currentTime: 20,
            duration: 60,
            playerState: PlayerState.PAUSED,
            playbackRate: 1,
            sentAtMs: 1_000,
        }, 5_000)).toBe(20);
    });

    it('downsamples spectrum buckets by average value', () => {
        expect(downsampleObsSpectrum(new Uint8Array([0, 10, 20, 30]), 2)).toEqual([5, 25]);
    });

    it('converts main-window blob covers to data URLs for OBS', async () => {
        const coverBlob = new Blob(['cover'], { type: 'image/png' });
        const fetchCover = async () => new Response(coverBlob);

        await expect(resolveObsBrowserSourceCoverUrl('blob:http://127.0.0.1/cover', fetchCover))
            .resolves.toBe('data:image/png;base64,Y292ZXI=');
    });

    it('keeps non-blob covers unchanged without fetching', async () => {
        let fetchCount = 0;
        const fetchCover = async () => {
            fetchCount += 1;
            return new Response(new Blob(['unused']));
        };

        await expect(resolveObsBrowserSourceCoverUrl('https://img.test/cover.jpg', fetchCover))
            .resolves.toBe('https://img.test/cover.jpg');
        expect(fetchCount).toBe(0);
    });

    it('converts custom visualizer image object URLs for OBS', async () => {
        const fetchImage = async () => new Response(new Blob(['image'], { type: 'image/webp' }));

        await expect(resolveObsBrowserSourceImageAsset({
            id: 'monet-portrait',
            name: 'portrait.webp',
            url: 'blob:http://127.0.0.1/portrait',
        }, fetchImage)).resolves.toEqual({
            id: 'monet-portrait',
            name: 'portrait.webp',
            url: 'data:image/webp;base64,aW1hZ2U=',
        });
    });

    it('converts every image in a Cappella custom pack', async () => {
        const fetchImage = async (url: string | URL | Request) => (
            new Response(new Blob([String(url).endsWith('/left') ? 'left' : 'right'], { type: 'image/png' }))
        );

        await expect(resolveObsBrowserSourceImageAssets([
            { id: 'left', name: 'left.png', url: 'blob:http://127.0.0.1/left' },
            { id: 'right', name: 'right.png', url: 'blob:http://127.0.0.1/right' },
        ], fetchImage)).resolves.toEqual([
            { id: 'left', name: 'left.png', url: 'data:image/png;base64,bGVmdA==' },
            { id: 'right', name: 'right.png', url: 'data:image/png;base64,cmlnaHQ=' },
        ]);
    });
});
