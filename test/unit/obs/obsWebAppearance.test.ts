import { describe, expect, it } from 'vitest';
import { compressConfig } from '@/components/modal/settings/AppearanceSettingsSubview';
import { buildObsAppearanceFromShortcode, parseObsWebParams } from '@/utils/obsWebAppearance';
import { buildObsNowPlayingUrl, extractCfgFromInput } from '@/utils/obsUrl';

// test/unit/obs/obsWebAppearance.test.ts
// OBS web 外观：cfg shortcode 经 compressConfig→decompress→映射到 VisualizerRenderer props 的 round-trip，
// 以及 URL 入参解析、导入剥壳、复制链接组装。

const sampleConfig = {
    theme: {
        light: {
            name: 'Light X',
            backgroundColor: '#ffffff',
            primaryColor: '#000000',
            accentColor: '#ff0000',
            secondaryColor: '#888888',
            fontStyle: 'sans' as const,
            animationIntensity: 'normal' as const,
            wordColors: [],
            lyricsIcons: [],
            description: '',
        },
        dark: {
            name: 'Dark X',
            backgroundColor: '#000000',
            primaryColor: '#ffffff',
            accentColor: '#00ff00',
            secondaryColor: '#aaaaaa',
            fontStyle: 'serif' as const,
            animationIntensity: 'calm' as const,
            wordColors: [],
            lyricsIcons: [],
            description: '',
        },
    },
    visualizerMode: 'monet',
    visualizerBackgroundMode: 'monet',
    backgroundOpacity: 0.85,
    visualizerOpacity: 0.95,
    hidePlayerTranslationSubtitle: true,
    showSubtitleTranslation: false,
    subtitleOverlayBackground: true,
    lyricsFontScale: 1.25,
};

describe('buildObsAppearanceFromShortcode', () => {
    const shortcode = compressConfig(sampleConfig);

    it('maps cfg fields to renderer props (with store→prop renames)', () => {
        const a = buildObsAppearanceFromShortcode(shortcode, { isDaylight: false, transparent: true });
        expect(a.mode).toBe('monet');
        expect(a.visualizerOpacity).toBe(0.95);
        expect(a.lyricsFontScale).toBe(1.25);
        expect(a.hideTranslationSubtitle).toBe(true); // hidePlayerTranslationSubtitle → hideTranslationSubtitle
        expect(a.showSubtitleTranslation).toBe(false);
        expect(a.subtitleOverlayBackground).toBe(true);
        expect(a.background.mode).toBe('monet');
        expect(a.background.common?.opacity).toBe(0.85);
        expect(a.background.transparent).toBe(true);
    });

    it('selects the theme side by daylight', () => {
        expect(buildObsAppearanceFromShortcode(shortcode, { isDaylight: false, transparent: true }).theme?.name).toBe('Dark X');
        expect(buildObsAppearanceFromShortcode(shortcode, { isDaylight: true, transparent: true }).theme?.name).toBe('Light X');
    });

    it('lets an explicit visualizer override win, ignoring an invalid one', () => {
        expect(buildObsAppearanceFromShortcode(shortcode, { isDaylight: false, transparent: true, visualizerOverride: 'classic' }).mode).toBe('classic');
        // 非法覆盖回退到 cfg 的 mode
        expect(buildObsAppearanceFromShortcode(shortcode, { isDaylight: false, transparent: true, visualizerOverride: 'not-a-mode' }).mode).toBe('monet');
    });

    it('falls back to defaults with no cfg, and stays render-safe on garbage cfg', () => {
        const none = buildObsAppearanceFromShortcode(null, { isDaylight: false, transparent: false });
        expect(none.theme).toBeNull();
        expect(typeof none.mode).toBe('string');
        expect(none.mode.length).toBeGreaterThan(0);
        expect(none.background.transparent).toBe(false);
        expect(none.background.mode).toBeUndefined();

        // Invalid cfg (hand-edited URL, etc.): no throw, falls back to defaults.
        const garbage = buildObsAppearanceFromShortcode('not-a-valid-shortcode', { isDaylight: false, transparent: true });
        expect(garbage.theme).toBeNull();
        expect(typeof garbage.mode).toBe('string');
    });

    it('drops a non-array urlBackgroundList instead of passing it through (render crash guard)', () => {
        const cfg = JSON.stringify({ visualizerMode: 'monet', visualizerBackgroundMode: 'url', urlBackgroundList: 'x' });
        const a = buildObsAppearanceFromShortcode(cfg, { isDaylight: false, transparent: false });
        expect(a.background.url).toBeUndefined();
    });
});

describe('parseObsWebParams', () => {
    it('reads host/cfg/daylight/transparent/visualizer with OBS defaults', () => {
        const p = parseObsWebParams('?host=localhost%3A9863&cfg=folia-theme%3A%2F%2Fabc&daylight=1&visualizer=cadenza');
        expect(p.host).toBe('localhost:9863');
        expect(p.cfg).toBe('folia-theme://abc');
        expect(p.isDaylight).toBe(true);
        expect(p.transparent).toBe(true); // 默认透明
        expect(p.visualizer).toBe('cadenza');
    });

    it('defaults to dark + transparent, and opaque only when transparent=0', () => {
        expect(parseObsWebParams('').isDaylight).toBe(false);
        expect(parseObsWebParams('').transparent).toBe(true);
        expect(parseObsWebParams('?transparent=0').transparent).toBe(false);
    });

    it('sanitizes host, stripping characters that would break the ws URL', () => {
        expect(parseObsWebParams('?host=localhost%3A9863%23').host).toBe('localhost:9863'); // trailing '#'
        expect(parseObsWebParams('?host=local%20host%3A9863').host).toBe('localhost:9863'); // internal space
    });
});

describe('extractCfgFromInput', () => {
    it('pulls cfg out of a full OBS URL', () => {
        const url = 'https://example.test/?obs=1&obsSource=now-playing&host=localhost%3A9863&cfg=folia-theme%3A%2F%2Fabc123';
        expect(extractCfgFromInput(url)).toBe('folia-theme://abc123');
    });

    it('passes through a bare shortcode or raw JSON', () => {
        expect(extractCfgFromInput('folia-theme://abc')).toBe('folia-theme://abc');
        expect(extractCfgFromInput('  {"visualizerMode":"monet"}  ')).toBe('{"visualizerMode":"monet"}');
    });
});

describe('buildObsNowPlayingUrl', () => {
    it('bakes source + host + cfg into the query', () => {
        const url = buildObsNowPlayingUrl('folia-theme://abc', 'localhost:9863');
        expect(url).toContain('obs=1');
        expect(url).toContain('obsSource=now-playing');
        expect(url).toContain('host=localhost%3A9863');
        expect(url).toContain('cfg=folia-theme');
        // round-trip：从组装的 URL 再剥回 cfg。
        expect(extractCfgFromInput(url.startsWith('http') ? url : `https://x.test${url}`)).toBe('folia-theme://abc');
    });
});
