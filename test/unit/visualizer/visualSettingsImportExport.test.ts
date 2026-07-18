import { describe, expect, it } from 'vitest';
import { compressConfig, decompressConfig } from '@/components/modal/settings/AppearanceSettingsSubview';

// test/unit/visualizer/visualSettingsImportExport.test.ts
// Verifies visual settings configuration compression, base64 encoding, and decompression/restoration.

describe('Visual Settings Import and Export', () => {
    const sampleConfig = {
        theme: {
            light: {
                name: 'Light Gold',
                backgroundColor: '#fffdf5',
                primaryColor: '#1c1917',
                accentColor: '#d97706',
                secondaryColor: '#78716c',
                fontStyle: 'sans' as const,
                animationIntensity: 'normal' as const,
                wordColors: [{ word: 'love', color: '#ff0000' }],
                lyricsIcons: ['heart'],
                description: 'A shiny gold theme for daylight playback',
            },
            dark: {
                name: 'Midnight Gold',
                backgroundColor: '#1c1917',
                primaryColor: '#fffdf5',
                accentColor: '#fbbf24',
                secondaryColor: '#a8a29e',
                fontStyle: 'serif' as const,
                animationIntensity: 'calm' as const,
            },
        },
        visualizerMode: 'monet',
        randomVisualizerModePerSong: true,
        visualizerBackgroundMode: 'monet',
        backgroundOpacity: 0.85,
        visualizerOpacity: 0.95,
        hidePlayerTranslationSubtitle: true,
        showSubtitleTranslation: false,
        subtitleOverlayBackground: true,
        lyricsFontStyle: 'sans',
        lyricsFontScale: 1.25,
        lyricsFontFallbackFamilies: ['Songti SC', 'SimSun', 'serif'],
        subtitleFontInheritsLyrics: false,
        subtitleFontStyle: 'sans',
        subtitleFontFamily: 'Microsoft YaHei',
        subtitleFontFallbackFamilies: ['PingFang SC', 'sans-serif'],
        classicTuning: {
            enableWordRotation: true,
            breathingFloatMultiplier: 1.2,
            useLegacyLayout: false,
            wordSpacing: 0.8,
        },
        cadenzaTuning: {
            fontScale: 1.15,
            widthRatio: 0.8,
            motionAmount: 0.9,
            glowIntensity: 1.1,
            beamIntensity: 0.2,
        },
        partitaTuning: {
            showGuideLines: false,
            useSemanticLayout: true,
            staggerMin: 15,
            staggerMax: 85,
        },
        fumeTuning: {
            hidePrintSymbols: true,
            disableGeometricBackground: false,
            backgroundObjectOpacity: 0.4,
            textHoldRatio: 0.8,
            cameraTrackingMode: 'smooth' as const,
            cameraSpeed: 1.2,
            glowIntensity: 0.9,
            heroScale: 1.1,
        },
        claddaghTuning: {
            focusScaleRatio: 0.75,
            radiusScale: 1.15,
            ellipseTiltDeg: 52,
        },
        cappellaTuning: {
            showEmoMessages: false,
            emojiPackSource: 'custom' as const,
            avatarSource: 'color' as const,
        },
        tiltTuning: {
            splitProbability: 0.8,
            tiltStyleProbability: 0.4,
            colorScheme: 'accentAll' as const,
        },
        dioramaTuning: {
            cameraSpeed: 1.1,
            motionAmount: 0.9,
            audioReactivity: 0.8,
            geometryVisibility: {
                enabled: true,
                mode: 'corridor' as const,
                strands: true,
                blobs: false,
                ribbons: true,
                rings: false,
            },
            particleDensity: 72,
            particleScale: 1.4,
            particleGlowEnabled: true,
            particleGlowIntensity: 0.75,
            showParticles: false,
            backgroundParticleCircumference: 40,
            backgroundParticleRadial: 3,
            glowEnabled: true,
            glowIntensity: 0.8,
            soulEnabled: false,
            soulIntensity: 1,
            soulActiveEnabled: true,
            gradientEnabled: true,
            gradientIntensity: 0.7,
            keywordColoringEnabled: false,
        },
        monetBackgroundTuning: {
            backgroundSource: 'cover-derived' as const,
            backgroundLayout: 'half-pane-gradient' as const,
            backgroundBlurPx: 4,
            backgroundOverlayOpacity: 0.5,
            backgroundGrayscale: 0.1,
            backgroundSaturation: 1.2,
            backgroundWash: 0.2,
            backgroundHalfPaneOffsetX: 5,
            backgroundWashColorMode: 'custom' as const,
            backgroundWashCustomColor: '#ff0000',
        },
        nomandBackgroundTuning: {
            imageSource: 'uploaded-global' as const,
            ditheringType: '4x4' as const,
            size: 3.5,
            colorSteps: 3,
            originalColors: false,
            inverted: true,
            overlayEnabled: true,
            overlayOpacity: 0.45,
        },
        latentBackgroundTuning: {
            displayMode: 'mesh' as const,
            colorSource: 'cover-only' as const,
            dynamicOnlyInPlayer: false,
            enhancedBeatResponse: false,
            ditheringSpeed: 0.4,
            ditheringAudioSpeed: 1.8,
            ditheringSize: 3,
            ditheringOpacity: 0.6,
            meshSpeed: 0.25,
            meshAudioSpeed: 2,
            meshDistortion: 1.1,
            meshSwirl: 0.3,
            overlayEnabled: false,
            overlayOpacity: 0.5,
        },
        monetTuning: {
            keywordColoringEnabled: false,
            showDescription: false,
            audioStyle: 'line' as const,
            fontScale: 1.1,
            portraitSource: 'cover' as const,
            portraitOffsetX: -120,
            portraitStyle: 'square' as const,
        },
        songThemeAutoSwitchEnabled: true,
        songThemeAutoGenerateEnabled: true,
    };

    it('correctly compresses a full config to a base64 theme code starting with folia-theme://', () => {
        const code = compressConfig(sampleConfig);
        expect(code.startsWith('folia-theme://')).toBe(true);

        const decoded = decompressConfig(code);
        expect(decoded.visualizerMode).toBe('monet');
        expect(decoded.randomVisualizerModePerSong).toBe(true);
        expect(decoded.backgroundOpacity).toBe(0.85);
        expect(decoded.hidePlayerTranslationSubtitle).toBe(true);
        expect(decoded.showSubtitleTranslation).toBe(false);
        expect(decoded.subtitleOverlayBackground).toBe(true);
        expect(decoded.lyricsFontFallbackFamilies).toEqual(['Songti SC', 'SimSun', 'serif']);
        expect(decoded.subtitleFontInheritsLyrics).toBe(false);
        expect(decoded.subtitleFontStyle).toBe('sans');
        expect(decoded.subtitleFontFamily).toBe('Microsoft YaHei');
        expect(decoded.subtitleFontFallbackFamilies).toEqual(['PingFang SC', 'sans-serif']);
        expect(decoded.classicTuning?.breathingFloatMultiplier).toBe(1.2);
        expect(decoded.claddaghTuning?.focusScaleRatio).toBe(0.75);
        expect(decoded.claddaghTuning?.radiusScale).toBe(1.15);
        expect(decoded.claddaghTuning?.ellipseTiltDeg).toBe(52);
        expect(decoded.dioramaTuning?.geometryVisibility).toEqual(sampleConfig.dioramaTuning.geometryVisibility);
        expect(decoded.dioramaTuning?.showParticles).toBe(false);
        expect(decoded.dioramaTuning?.soulActiveEnabled).toBe(true);
        expect(decoded.dioramaTuning?.backgroundParticleCircumference).toBe(40);
        expect(decoded.dioramaTuning?.backgroundParticleRadial).toBe(3);
        expect(decoded.theme?.light.name).toBe('Light Gold');
        expect(decoded.theme?.dark.accentColor).toBe('#fbbf24');
        expect(decoded.monetBackgroundTuning?.backgroundBlurPx).toBe(4);
        expect(decoded.nomandBackgroundTuning).toEqual(sampleConfig.nomandBackgroundTuning);
        expect(decoded.latentBackgroundTuning).toEqual(sampleConfig.latentBackgroundTuning);
        expect(decoded.monetTuning?.portraitOffsetX).toBe(-120);
        expect(decoded.monetTuning?.portraitStyle).toBe('square');
        expect(decoded.songThemeAutoSwitchEnabled).toBe(true);
        expect(decoded.songThemeAutoGenerateEnabled).toBe(true);

        // Verify custom properties alignment
        expect(decoded.theme?.light.wordColors).toEqual([{ word: 'love', color: '#ff0000' }]);
        expect(decoded.theme?.light.lyricsIcons).toEqual(['heart']);
        expect(decoded.theme?.light.description).toBe('A shiny gold theme for daylight playback');

        // Verify default fallback properties for missing values in dark theme
        expect(decoded.theme?.dark.wordColors).toEqual([]);
        expect(decoded.theme?.dark.lyricsIcons).toEqual([]);
        expect(decoded.theme?.dark.description).toBe('');
    });

    it('correctly parses and decompresses raw long-format JSON', () => {
        const jsonString = JSON.stringify(sampleConfig);
        const decoded = decompressConfig(jsonString);
        expect(decoded.visualizerMode).toBe('monet');
        expect(decoded.randomVisualizerModePerSong).toBe(true);
        expect(decoded.backgroundOpacity).toBe(0.85);
        expect(decoded.hidePlayerTranslationSubtitle).toBe(true);
        expect(decoded.showSubtitleTranslation).toBe(false);
        expect(decoded.subtitleOverlayBackground).toBe(true);
        expect(decoded.lyricsFontFallbackFamilies).toEqual(['Songti SC', 'SimSun', 'serif']);
        expect(decoded.subtitleFontInheritsLyrics).toBe(false);
        expect(decoded.subtitleFontStyle).toBe('sans');
        expect(decoded.subtitleFontFamily).toBe('Microsoft YaHei');
        expect(decoded.subtitleFontFallbackFamilies).toEqual(['PingFang SC', 'sans-serif']);
        expect(decoded.claddaghTuning?.ellipseTiltDeg).toBe(52);
        expect(decoded.theme?.light.name).toBe('Light Gold');
        expect(decoded.theme?.dark.accentColor).toBe('#fbbf24');
        expect(decoded.songThemeAutoSwitchEnabled).toBe(true);
        expect(decoded.songThemeAutoGenerateEnabled).toBe(true);
    });

    it('migrates the removed Nomand random dithering option to 8x8', () => {
        const encoded = compressConfig({
            nomandBackgroundTuning: {
                imageSource: 'cover-derived',
                ditheringType: 'random',
                size: 2,
                colorSteps: 2,
                originalColors: false,
                inverted: false,
            },
        });
        const decoded = decompressConfig(encoded);

        expect(decoded.nomandBackgroundTuning.ditheringType).toBe('8x8');
        expect(decoded.nomandBackgroundTuning.overlayEnabled).toBe(true);
        expect(decoded.nomandBackgroundTuning.overlayOpacity).toBe(0.35);
    });

    it('round-trips a Diorama-only short code including geometry child switches', () => {
        const code = compressConfig({ dioramaTuning: sampleConfig.dioramaTuning });
        const decoded = decompressConfig(code);

        expect(decoded.dioramaTuning).toEqual(sampleConfig.dioramaTuning);
    });

    it('gracefully throws error on invalid configuration input strings', () => {
        expect(() => decompressConfig('invalid string')).toThrow();
        expect(() => decompressConfig('folia-theme://invalidbase64@@')).toThrow();
        expect(() => decompressConfig('{"invalid": "json"}')).toThrow();
    });
});
