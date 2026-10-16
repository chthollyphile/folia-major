import { describe, expect, it } from 'vitest';
import { DEFAULT_SONNET_TUNING, PlayerState } from '../../src/types';
import {
    buildObsBrowserSourceConfigSignature,
    buildLegacyObsBrowserSourceBackgroundConfig,
    createObsClockSkewCorrector,
    OBS_STALLED_CLOCK_MAX_EXTRAPOLATION_MS,
    resolvePublishedObsClockTime,
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

    describe('publishing a clock while the main window frame loop is stalled', () => {
        it('replays the recorded minimized-window steps without moving the overlay backwards', () => {
            // Recorded: currentTime held at 287.313 for a second, then stepped to 288.318, while every
            // 250ms clock went out as PLAYING. Before the fix the overlay snapped back 0.25s each time.
            const anchors = [{ at: 0, time: 287.313 }, { at: 1_005, time: 288.318 }];
            let previousOverlayTime = -Infinity;
            for (let nowMs = 0; nowMs <= 1_750; nowMs += 250) {
                const anchor = [...anchors].reverse().find(item => item.at <= nowMs)!;
                const published = resolvePublishedObsClockTime({
                    sampledTime: anchor.time,
                    changedAtMs: anchor.at,
                    nowMs,
                    playing: true,
                    duration: 425,
                });
                const clock = {
                    currentTime: published,
                    duration: 425,
                    playerState: PlayerState.PLAYING,
                    playbackRate: 1,
                    sentAtMs: nowMs,
                };
                // Overlay frames right after this clock arrives and just before the next one.
                for (const renderAt of [nowMs + 10, nowMs + 240]) {
                    const overlayTime = resolveObsBrowserSourceClockTime(clock, renderAt);
                    expect(overlayTime).toBeGreaterThanOrEqual(previousOverlayTime - 0.01);
                    previousOverlayTime = overlayTime;
                }
            }
        });

        it('reports the sampled value while paused, when fresh, or once the stall is too long', () => {
            const base = { sampledTime: 30, changedAtMs: 1_000, duration: 200 };
            expect(resolvePublishedObsClockTime({ ...base, nowMs: 1_600, playing: false })).toBe(30);
            expect(resolvePublishedObsClockTime({ ...base, nowMs: 1_000, playing: true })).toBe(30);
            expect(resolvePublishedObsClockTime({ ...base, nowMs: 1_600, playing: true })).toBeCloseTo(30.6, 6);
            expect(resolvePublishedObsClockTime({
                ...base,
                nowMs: 1_000 + OBS_STALLED_CLOCK_MAX_EXTRAPOLATION_MS + 1,
                playing: true,
            })).toBe(30);
        });

        it('never carries the time past the track duration', () => {
            expect(resolvePublishedObsClockTime({
                sampledTime: 199.5,
                changedAtMs: 0,
                nowMs: 1_500,
                playing: true,
                duration: 200,
            })).toBe(200);
        });
    });

    describe('clock skew between the PC and an overlay on another device', () => {
        const PC_SENT_AT = 1_000_000;
        // The PC publishes "10s into the song" at PC time 1_000_000; the frame renders 2.5s later
        // on the overlay device, with 20ms of network delay on the way.
        const clockAt = (sentAtMs: number) => ({
            currentTime: 10,
            duration: 240,
            playerState: PlayerState.PLAYING,
            playbackRate: 1,
            sentAtMs,
        });

        it.each([
            ['3s ahead', 3_000],
            ['3s behind', -3_000],
            ['in sync', 0],
        ])('keeps lyric time right when the overlay clock is %s', (_label, skewMs) => {
            const correct = createObsClockSkewCorrector();
            const receivedAt = PC_SENT_AT + 20 + skewMs;
            const corrected = correct(clockAt(PC_SENT_AT), receivedAt);

            const renderAt = receivedAt + 2_500;
            expect(resolveObsBrowserSourceClockTime(corrected, renderAt)).toBeCloseTo(12.5, 3);
        });

        it('shows the bug it fixes: without correction a tablet 3s ahead runs the lyrics 3s early', () => {
            const receivedAt = PC_SENT_AT + 20 + 3_000;
            expect(resolveObsBrowserSourceClockTime(clockAt(PC_SENT_AT), receivedAt + 2_500)).toBeCloseTo(15.52, 3);
        });

        it('uses the fastest delivery in the window, so one late sample does not shift the lyrics', () => {
            const correct = createObsClockSkewCorrector();
            const skewMs = 1_000;
            correct(clockAt(PC_SENT_AT), PC_SENT_AT + skewMs + 15);
            // This one sat in a buffer for 400ms.
            const late = correct(clockAt(PC_SENT_AT + 250), PC_SENT_AT + 250 + skewMs + 400);

            expect(late.sentAtMs).toBe(PC_SENT_AT + 250 + skewMs + 15);
        });

        it('forgets samples older than the window, so a changed clock is picked up', () => {
            const correct = createObsClockSkewCorrector(3);
            correct(clockAt(0), 10);
            correct(clockAt(250), 260);
            correct(clockAt(500), 510);
            // The overlay clock jumped forward by 5s (e.g. an NTP sync); older samples age out.
            correct(clockAt(750), 5_760);
            correct(clockAt(1_000), 6_010);
            const settled = correct(clockAt(1_250), 6_260);

            expect(settled.sentAtMs).toBe(1_250 + 5_010);
        });
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
