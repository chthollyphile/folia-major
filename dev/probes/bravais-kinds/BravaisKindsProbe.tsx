import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibrarySuiteStageProps } from '../../../src/library/core/suite/suite.contract';
import type { BravaisItemKind, BravaisLayer } from '../../../src/library/suites/bravais/bravaisLayer';
import BravaisStage from '../../../src/library/suites/bravais/BravaisStage';
import { useBravaisLayerRegistration } from '../../../src/library/suites/bravais/useBravaisLayerRegistration';
import { useLatticeSettingsStore } from '../../../src/stores/useLatticeSettingsStore';
import { useLibraryWallLookStore } from '../../../src/stores/useLibraryWallLookStore';
import type { LibraryWallLook } from '../../../src/utils/libraryWallLook';
import { LIBRARY_WALL_SEAM_STYLES, type LibraryWallSeamStyle } from '../../../src/utils/libraryWallSeamStyle';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../../src/services/baseThemes';
import { buildKindsItems, KINDS_DEFAULT_CURRENT, loadKindsCovers, type KindsCovers } from './kindsData';

// dev/probes/bravais-kinds/BravaisKindsProbe.tsx
// 磁贴种类区分的探针（?probe=bravaisKinds，设计稿 §7.7）：真实的 BravaisStage + 一面歌曲 / 专辑 / 歌单 / 歌手 / 特殊卡混排
// 的首页墙（合成封面）。给组件用例、截图与双色调的开销对比用。
// 选项（mount 的 props，或 URL 参数，props 优先）：
//   theme=midnight|daylight|vivid  主题（午夜墨染 / 日光素白 / 一套彩色强调色的暗色主题）
//   look=solid|partial|clear       透光三档（写 useLibraryWallLookStore 的内存值，不写存储）
//   lights=on|off  tint=on|off     熄灯、海报叠色（写 useLatticeSettingsStore 的内存值）
//   edges=on|off                   集合叠页边（设置「集合叠页边」，写 useLibraryWallLookStore 的内存值；默认开）
//   seam=paper|white|black|frost|dots|hatch|contour|check  信息条实色模式的预设（内存值；默认 paper）
//   clearSeam=on|off               信息条始终透明（内存值；默认关）
//   lyrics=on|off  blur=on|off     墙后画面的歌词 / 模糊（内存值；默认关）。stage 报的遮挡与 backdrop 记在
//                                  window.__bravaisKindsProbe.reports() 里（探针下面没有 visualizer）
//   current=<条目 key>|none        正在播放的那一项（默认第 2 首歌；给歌手 / 专辑的 key 可以强行让它挂 is-current）
//   mix=mixed|artists              混排，或整面墙只有歌手（双色调开销的最坏情况）
// 自动化入口 window.__bravaisKindsProbe：ready() 封面画好、层已登记。

export type KindsTheme = 'midnight' | 'daylight' | 'vivid';

export type BravaisKindsProbeProps = {
    theme?: KindsTheme;
    look?: LibraryWallLook;
    lights?: 'on' | 'off';
    tint?: 'on' | 'off';
    edges?: 'on' | 'off';
    seam?: LibraryWallSeamStyle;
    clearSeam?: 'on' | 'off';
    lyrics?: 'on' | 'off';
    blur?: 'on' | 'off';
    current?: string;
    mix?: 'mixed' | 'artists';
    /** 再加一位歌手、头像是这个地址（只从 props 给）。 */
    extraArtistCover?: string;
};

const THEMES: Record<KindsTheme, { bg: string; primary: string; accent: string; secondary: string; daylight: boolean }> = {
    midnight: { bg: '#09090b', primary: '#f4f4f5', accent: '#f4f4f5', secondary: '#71717a', daylight: false },
    daylight: { bg: '#f5f5f4', primary: '#1c1917', accent: '#ea580c', secondary: '#44403c', daylight: true },
    vivid: { bg: '#0b0a0c', primary: '#f7f4ee', accent: '#fd5c47', secondary: '#6a48ff', daylight: false },
};

const KIND_LABEL_KEYS: Record<BravaisItemKind, string> = {
    track: 'libraryBravais.kind.track',
    playlist: 'libraryBravais.kind.playlist',
    album: 'libraryBravais.kind.album',
    artist: 'libraryBravais.kind.artist',
    folder: 'libraryBravais.kind.folder',
    feed: 'libraryBravais.kind.feed',
};

const NO_KEYS: ReadonlySet<string> = new Set();
const NOOP = () => { };
const reports: { occludes: boolean | null; backdrop: { lyrics: boolean; blur: boolean } | null } = { occludes: null, backdrop: null };
const recordOcclusion = (occludes: boolean) => { reports.occludes = occludes; };
const recordBackdrop = (backdrop: { lyrics: boolean; blur: boolean }) => { reports.backdrop = { ...backdrop }; };
const NAVIGATION: LibrarySuiteStageProps['navigation'] = { depth: 0, origin: null, activeType: null };

declare global {
    interface Window {
        __bravaisKindsProbe?: {
            ready: () => boolean;
            /** stage 最近一次报的遮挡与透出画面（没报过时为 null）。 */
            reports: () => { occludes: boolean | null; backdrop: { lyrics: boolean; blur: boolean } | null };
        };
    }
}

const readParams = (props: BravaisKindsProbeProps): Required<BravaisKindsProbeProps> => {
    const params = new URLSearchParams(window.location.search);
    const pick = <T extends string>(key: keyof BravaisKindsProbeProps, allowed: readonly T[], fallback: T): T => {
        const value = (props[key] ?? params.get(key)) as T | null;
        return value && allowed.includes(value) ? value : fallback;
    };
    return {
        theme: pick('theme', ['midnight', 'daylight', 'vivid'] as const, 'midnight'),
        look: pick('look', ['solid', 'partial', 'clear'] as const, 'solid'),
        lights: pick('lights', ['on', 'off'] as const, 'on'),
        tint: pick('tint', ['on', 'off'] as const, 'off'),
        edges: pick('edges', ['on', 'off'] as const, 'on'),
        seam: pick('seam', LIBRARY_WALL_SEAM_STYLES, 'paper'),
        clearSeam: pick('clearSeam', ['on', 'off'] as const, 'off'),
        lyrics: pick('lyrics', ['on', 'off'] as const, 'off'),
        blur: pick('blur', ['on', 'off'] as const, 'off'),
        current: props.current ?? params.get('current') ?? KINDS_DEFAULT_CURRENT,
        mix: pick('mix', ['mixed', 'artists'] as const, 'mixed'),
        extraArtistCover: props.extraArtistCover ?? '',
    };
};

type KindsStageProps = { covers: KindsCovers; current: string; daylight: boolean; mix: 'mixed' | 'artists'; extraArtistCover: string };

const KindsStage: React.FC<KindsStageProps> = ({ covers, current, daylight, mix, extraArtistCover }) => {
    const { t } = useTranslation();
    const labels = useMemo(() => ({
        kindLabel: (kind: BravaisItemKind) => t(KIND_LABEL_KEYS[kind]),
        trackCount: (count: number) => t('libraryBravais.trackCount', { count }),
    }), [t]);
    const layer = useMemo<BravaisLayer>(() => {
        const items = buildKindsItems(covers, labels, mix, extraArtistCover || undefined);
        return {
            key: 'home:kinds',
            sessionKey: 'probe:kinds',
            surface: 'home',
            mode: 'infinite',
            items,
            seam: { title: t('libraryBravais.home.title', { defaultValue: 'Library' }), crumb: 'Library', meta: '' },
            isInteractive: true,
            focusedEntryKey: null,
            nowPlayingKey: current === 'none' ? null : current,
            queuedKeys: NO_KEYS,
            onOpenItem: NOOP,
            onPlayItem: NOOP,
            onEnqueueItem: NOOP,
        };
    }, [covers, current, extraArtistCover, labels, mix, t]);
    useBravaisLayerRegistration('home', layer);
    return (
        <BravaisStage
            isInteractive
            theme={daylight ? DAYLIGHT_THEME : DEFAULT_THEME}
            isDaylight={daylight}
            navigation={NAVIGATION}
            reportPlayerOcclusion={recordOcclusion}
            reportPlayerBackdrop={recordBackdrop}
        />
    );
};

const BravaisKindsProbe: React.FC<BravaisKindsProbeProps> = (props) => {
    const options = readParams(props);
    const theme = THEMES[options.theme];
    const [covers, setCovers] = useState<KindsCovers | null>(null);

    useEffect(() => {
        let alive = true;
        void loadKindsCovers().then(result => { if (alive) setCovers(result); });
        return () => { alive = false; };
    }, []);

    // 外观偏好只写 store 的内存值（不经 setter，不写 localStorage）。
    useEffect(() => {
        useLibraryWallLookStore.setState({
            look: options.look,
            collectionStackEdges: options.edges === 'on',
            seamStyle: options.seam,
            seamClear: options.clearSeam === 'on',
            backdropLyrics: options.lyrics === 'on',
            backdropBlur: options.blur === 'on',
        });
    }, [options.blur, options.clearSeam, options.edges, options.look, options.lyrics, options.seam]);
    useEffect(() => {
        useLatticeSettingsStore.setState({ latticeLightsOn: options.lights === 'on', latticePosterTintEnabled: options.tint === 'on' });
    }, [options.lights, options.tint]);

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty('--bg-color', theme.bg);
        root.style.setProperty('--text-primary', theme.primary);
        root.style.setProperty('--text-accent', theme.accent);
        root.style.setProperty('--text-secondary', theme.secondary);
    }, [theme]);

    useEffect(() => {
        window.__bravaisKindsProbe = {
            ready: () => Boolean(covers) && Boolean(document.querySelector('.bravais-tile[data-library-card]')),
            reports: () => ({ occludes: reports.occludes, backdrop: reports.backdrop }),
        };
        return () => { delete window.__bravaisKindsProbe; };
    }, [covers]);

    return (
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: theme.bg }} data-kinds-theme={options.theme}>
            {covers && <KindsStage covers={covers} current={options.current} daylight={theme.daylight} mix={options.mix} extraArtistCover={options.extraArtistCover} />}
        </div>
    );
};

export default BravaisKindsProbe;
