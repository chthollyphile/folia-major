import { describe, expect, it } from 'vitest';
import { PlayerState } from '../../src/types';
import {
    buildLegacyObsBrowserSourceBackgroundConfig,
    downsampleObsSpectrum,
    resolveObsBrowserSourceClockTime,
    resolveObsBrowserSourceCoverUrl,
    resolveObsBrowserSourceImageAsset,
    resolveObsBrowserSourceImageAssets,
} from '../../src/utils/obsBrowserSource';

describe('obsBrowserSource utilities', () => {
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
