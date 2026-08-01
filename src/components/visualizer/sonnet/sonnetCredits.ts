import type { Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { clamp01, easeSonnetInOut } from './sonnetMotion';

// src/components/visualizer/sonnet/sonnetCredits.ts
// Builds and times the deterministic end-credits poster shown after the final lyric.
type PixiModule = typeof import('pixi.js');

export interface SonnetCreditsFrame {
    active: boolean;
    lyricAlpha: number;
    lyricBlur: number;
    posterAlpha: number;
    posterOffsetY: number;
    posterScale: number;
}

export interface SonnetCreditsMetadata {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
}

const normalizeMetadata = (value?: string | null) => value?.trim() ?? '';

// Staggers lyric defocus and poster entrance while remaining deterministic under seeks.
export const resolveSonnetCreditsFrame = (
    time: number,
    finalLyricEndTime: number,
): SonnetCreditsFrame => {
    const elapsed = time - finalLyricEndTime;
    if (elapsed <= 0) {
        return {
            active: false,
            lyricAlpha: 1,
            lyricBlur: 0,
            posterAlpha: 0,
            posterOffsetY: 0.04,
            posterScale: 0.965,
        };
    }
    const lyricExit = easeSonnetInOut(clamp01(elapsed / 1.25));
    const posterEnter = easeSonnetInOut(clamp01((elapsed - 0.38) / 1.55));
    return {
        active: true,
        lyricAlpha: 1 - lyricExit,
        lyricBlur: lyricExit * 18,
        posterAlpha: posterEnter,
        posterOffsetY: (1 - posterEnter) * 0.04,
        posterScale: 0.965 + posterEnter * 0.035,
    };
};

export const hasSonnetCreditsMetadata = (metadata: SonnetCreditsMetadata) => Boolean(
    normalizeMetadata(metadata.title)
    || normalizeMetadata(metadata.artist)
    || normalizeMetadata(metadata.album)
);

export const buildSonnetCreditsPoster = (
    pixi: PixiModule,
    theme: Theme,
    metadata: SonnetCreditsMetadata,
    width: number,
    height: number,
    lyricsFontScale: number,
) => {
    const container = new pixi.Container();
    const title = normalizeMetadata(metadata.title);
    const artist = normalizeMetadata(metadata.artist);
    const album = normalizeMetadata(metadata.album);
    const fontFamily = resolveThemeFontStack(theme);
    const titleWeight = resolveThemeFontWeight(theme, 700);
    const detailWeight = resolveThemeFontWeight(theme, 500);
    const left = Math.max(38, width * 0.105);
    const right = Math.max(38, width * 0.09);
    const contentWidth = Math.max(220, width - left - right);
    const titleSize = Math.max(42, Math.min(118, width * 0.088 * lyricsFontScale));
    const detailSize = Math.max(13, Math.min(25, width * 0.018 * lyricsFontScale));
    const accent = pixi.Color.shared.setValue(theme.accentColor).toNumber();
    const primary = pixi.Color.shared.setValue(theme.primaryColor).toNumber();
    const secondary = pixi.Color.shared.setValue(theme.secondaryColor).toNumber();
    const geometry = new pixi.Graphics();

    geometry
        .rect(left, height * 0.155, Math.max(42, width * 0.075), 5)
        .fill({ color: accent, alpha: 0.95 })
        .rect(left, height * 0.155, 2, height * 0.57)
        .fill({ color: primary, alpha: 0.22 })
        .rect(width - right - 8, height * 0.225, 8, height * 0.34)
        .fill({ color: secondary, alpha: 0.32 })
        .moveTo(left, height * 0.79)
        .lineTo(width - right, height * 0.79)
        .stroke({ color: primary, width: 1, alpha: 0.36 });
    container.addChild(geometry);

    if (artist) {
        const artistText = new pixi.Text({
            text: artist.toLocaleUpperCase(),
            style: new pixi.TextStyle({
                fontFamily,
                fontWeight: String(detailWeight) as import('pixi.js').TextStyleFontWeight,
                fontSize: detailSize,
                fill: theme.accentColor,
                letterSpacing: Math.max(2, detailSize * 0.18),
                wordWrap: true,
                wordWrapWidth: contentWidth * 0.72,
            }),
        });
        artistText.position.set(left + 20, height * 0.205);
        container.addChild(artistText);
    }

    if (title) {
        const titleText = new pixi.Text({
            text: title,
            style: new pixi.TextStyle({
                fontFamily,
                fontWeight: String(titleWeight) as import('pixi.js').TextStyleFontWeight,
                fontSize: titleSize,
                fill: theme.primaryColor,
                leading: -Math.max(2, titleSize * 0.08),
                letterSpacing: -Math.max(0.5, titleSize * 0.018),
                wordWrap: true,
                wordWrapWidth: contentWidth * 0.88,
                breakWords: true,
            }),
        });
        titleText.position.set(left + 16, height * 0.285);
        container.addChild(titleText);
    }

    if (album) {
        const albumText = new pixi.Text({
            text: `— ${album}`,
            style: new pixi.TextStyle({
                fontFamily,
                fontWeight: String(detailWeight) as import('pixi.js').TextStyleFontWeight,
                fontSize: detailSize * 0.92,
                fill: theme.secondaryColor,
                letterSpacing: Math.max(1, detailSize * 0.1),
                wordWrap: true,
                wordWrapWidth: contentWidth * 0.72,
            }),
        });
        albumText.position.set(left + 18, height * 0.825);
        container.addChild(albumText);
    }

    container.pivot.set(width / 2, height / 2);
    container.position.set(width / 2, height / 2);
    return container;
};
