import { useEffect, useState } from 'react';
import type { Theme } from '../../../types';
import { mixColors, parseColorChannels } from '../../../utils/colorMix';
import { resolveTemperaPalette } from '../../../components/visualizer/tempera/temperaPalette';
import { extractRepresentativeColors } from '../../../utils/colorExtractor';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/bravaisPosterPalette.ts
// 歌手海报与旁边那面墙共用的一套颜色：和凝彩一样，从封面取色、走凝彩的渐变调色板（resolveTemperaPalette 的 gradient：
// 每个封面色往主题方向混一点，再按明暗排到纸色 → 墨色的四档阶梯上）。取色的封面是这位歌手最火的三张专辑——热门歌曲
// 是按热度排的，取前几首所属专辑里不重复的前三张封面；热门歌曲没有封面时退回墙上的专辑。
// 海报的底色、几何形、虚影、立体字的残影、碎字，墙上封面的那层色调，海报与墙之间的渐隐，都从这一套里取（CSS 变量
// 写在 stage 根节点上）。没取到颜色（没有封面、跨源读不到像素）时是 null，CSS 里的灰色就是回退。

const SOURCE_COVER_COUNT = 3;
const SAMPLE_COVER_PX = 128;

/** 最火的三张专辑封面：热门歌曲（按热度）所属专辑在前，不够再用墙上的专辑。 */
export const resolvePosterPaletteSources = (items: readonly BravaisItem[]): string[] => {
    const urls: string[] = [];
    const add = (url: string | undefined) => {
        if (url && !urls.includes(url) && urls.length < SOURCE_COVER_COUNT) urls.push(url);
    };
    items.forEach(item => { if (item.kind === 'track') add(item.coverUrl); });
    items.forEach(item => { if (item.kind === 'album') add(item.coverUrl); });
    return urls;
};

export type BravaisPosterPalette = {
    /** 海报底色（中心）与压暗的四周。 */
    ground: string;
    groundDeep: string;
    edge: string;
    /** 装定妆照的几何形里垫底的颜色、它的虚影。 */
    shape: string;
    ghost: string;
    /** 立体残影从浅到深的四层。 */
    extrude: readonly [string, string, string, string];
    /** 碎字。 */
    scrap: string;
    /** 墙上封面那层色调。 */
    wallTint: string;
};

/** 海报自己的「主题」：深色纸、浅色墨，主色与副色就是封面色（凝彩的 gradient 会把封面色往它们混一点）。 */
const posterTheme = (colors: readonly string[]): Theme => ({
    name: 'bravais-poster',
    backgroundColor: '#2b2b2e',
    primaryColor: '#f4f4f4',
    accentColor: colors[0],
    secondaryColor: colors[1] ?? colors[0],
    fontStyle: 'sans',
    animationIntensity: 'normal',
});

/** 封面色 → 海报的一套颜色。少于两个颜色时没有调色板（回退到 CSS 里的灰）。 */
export const resolveBravaisPosterPalette = (colors: readonly string[]): BravaisPosterPalette | null => {
    if (colors.length < 2) return null;
    const palette = resolveTemperaPalette(posterTheme(colors), { colorMode: 'gradient' }, [...colors]);
    const { paper, tone1, tone2, tone3 } = palette;
    return {
        ground: tone2,
        groundDeep: mixColors(tone1, tone2, 0.4),
        edge: mixColors(paper, tone1, 0.5),
        shape: mixColors(paper, tone1, 0.3),
        ghost: tone1,
        extrude: [tone3, mixColors(tone2, tone3, 0.5), tone2, tone1],
        scrap: tone3,
        wallTint: tone3,
    };
};

/**
 * 专辑海报的一套颜色（参考稿 album.png）：上半是浅色点阵纸、下半是一块深色、标题是奶油色的立体大字、下划线与
 * 主按钮是强调色。同样走凝彩的渐变调色板，只是主题换成浅纸深墨：四档阶梯里最深、最饱和的两档分别当色块与强调色。
 * 右边那面墙的双色调（封面碎片 / 拼贴）也从这里取：暗部 = 色块，亮部 = 强调色。
 */
export type BravaisAlbumPalette = {
    paper: string;
    ink: string;
    block: string;
    blockDeep: string;
    title: string;
    extrude: readonly [string, string, string, string];
    accent: string;
};

const ALBUM_PAPER = '#efe9dc';
const ALBUM_INK = '#141210';

const channelsOf = (color: string) => parseColorChannels(color) ?? { r: 128, g: 128, b: 128 };
const luminanceOf = (color: string) => {
    const { r, g, b } = channelsOf(color);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const saturationOf = (color: string) => {
    const { r, g, b } = channelsOf(color);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
};

export const resolveBravaisAlbumPalette = (colors: readonly string[]): BravaisAlbumPalette | null => {
    if (colors.length < 2) return null;
    const palette = resolveTemperaPalette(
        { ...posterTheme(colors), backgroundColor: ALBUM_PAPER, primaryColor: ALBUM_INK },
        { colorMode: 'gradient' },
        [...colors],
    );
    const tones = [palette.tone1, palette.tone2, palette.tone3, palette.tone4];
    // 色块：最深的那档（再往墨色压一点，奶油色的字压在上面才读得清）。强调色：剩下几档（连同封面原色）里又饱和、
    // 又和色块差得开的那个——只看饱和度会挑到和色块同一个蓝，下划线就看不见了。
    const darkest = [...tones].sort((a, b) => luminanceOf(a) - luminanceOf(b))[0];
    const block = mixColors(darkest, ALBUM_INK, 0.25);
    const distanceToBlock = (color: string) => {
        const a = channelsOf(color);
        const b = channelsOf(block);
        return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) / 441;
    };
    const accent = [...tones.filter(tone => tone !== darkest), ...colors]
        .map(color => ({ color, score: saturationOf(color) * distanceToBlock(color) }))
        .sort((a, b) => b.score - a.score)[0]?.color ?? palette.accent;
    const title = mixColors(ALBUM_PAPER, accent, 0.12);
    return {
        paper: mixColors(ALBUM_PAPER, tones[0], 0.06),
        ink: ALBUM_INK,
        block,
        blockDeep: mixColors(block, ALBUM_INK, 0.45),
        title,
        extrude: [mixColors(title, block, 0.25), mixColors(title, block, 0.45), mixColors(title, block, 0.65), mixColors(block, ALBUM_INK, 0.3)],
        accent,
    };
};

/** 专辑调色板 → stage 根节点上的 CSS 变量（专辑海报、缝的底、墙上碎片与拼贴的双色调都读它们）。 */
export const albumPaletteVars = (palette: BravaisAlbumPalette | null): Record<string, string> => (palette ? {
    '--bravais-album-paper': palette.paper,
    '--bravais-album-ink': palette.ink,
    '--bravais-album-block': palette.block,
    '--bravais-album-block-deep': palette.blockDeep,
    '--bravais-album-title': palette.title,
    '--bravais-album-extrude-1': palette.extrude[0],
    '--bravais-album-extrude-2': palette.extrude[1],
    '--bravais-album-extrude-3': palette.extrude[2],
    '--bravais-album-extrude-4': palette.extrude[3],
    '--bravais-album-accent': palette.accent,
} : {});

/** 几张封面各取两个代表色，交错排（第一张的主色、第二张的主色、第三张的主色、第一张的次色……）。 */
export const interleavePosterColors = (perCover: readonly (readonly string[])[]) => {
    const out: string[] = [];
    for (let rank = 0; rank < 2; rank += 1) perCover.forEach(colors => { if (colors[rank]) out.push(colors[rank]); });
    return out;
};

/** 封面组合 → 调色板（含取不到的 null），模块里缓存，同一位歌手 / 同一张专辑只取一次。 */
export type BravaisPosterPalettes = { artist: BravaisPosterPalette | null; album: BravaisAlbumPalette | null };
const cache = new Map<string, BravaisPosterPalettes | null>();
const ALBUM_SAMPLE_COLORS = 5;

export const useBravaisPosterPalette = (urls: readonly string[], enabled: boolean): BravaisPosterPalettes | null => {
    const key = enabled ? urls.join('\n') : '';
    const [palette, setPalette] = useState<BravaisPosterPalettes | null>(() => (key ? cache.get(key) ?? null : null));
    useEffect(() => {
        if (!key) {
            setPalette(null);
            return undefined;
        }
        if (cache.has(key)) {
            setPalette(cache.get(key) ?? null);
            return undefined;
        }
        let cancelled = false;
        const sample = (url: string, count: number) => extractRepresentativeColors(getSizedCoverUrl(url, SAMPLE_COVER_PX), count).catch(() => [] as string[]);
        // 专辑那套主要看第一张（专辑封面）：多取几个色，强调色才挑得到封面上那一小块亮色。
        Promise.all([Promise.all(urls.map(url => sample(url, 2))), urls[0] ? sample(urls[0], ALBUM_SAMPLE_COLORS) : []])
            .then(([perCover, lead]) => {
                const colors = interleavePosterColors(perCover);
                const artist = resolveBravaisPosterPalette(colors);
                const next = artist ? { artist, album: resolveBravaisAlbumPalette([...colors, ...lead.filter(color => !colors.includes(color))]) } : null;
                cache.set(key, next);
                if (!cancelled) setPalette(next);
            });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key 已经编码了 urls
    }, [key]);
    return palette;
};

/** 调色板 → stage 根节点上的 CSS 变量（海报、墙的色调、渐隐都读它们）。 */
export const posterPaletteVars = (palette: BravaisPosterPalette | null): Record<string, string> => (palette ? {
    '--bravais-poster-ground': palette.ground,
    '--bravais-poster-ground-deep': palette.groundDeep,
    '--bravais-poster-edge': palette.edge,
    '--bravais-poster-shape-fill': palette.shape,
    '--bravais-poster-ghost': palette.ghost,
    '--bravais-poster-extrude-1': palette.extrude[0],
    '--bravais-poster-extrude-2': palette.extrude[1],
    '--bravais-poster-extrude-3': palette.extrude[2],
    '--bravais-poster-extrude-4': palette.extrude[3],
    '--bravais-poster-scrap': palette.scrap,
    '--bravais-poster-wall-tint': palette.wallTint,
} : {});
