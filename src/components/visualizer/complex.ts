import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_CAPPELLA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_PARTITA_TUNING,
    DEFAULT_TILT_TUNING,
    type CadenzaTuning,
    type CappellaTuning,
    type FumeTuning,
    type PartitaTuning,
    type TiltTuning,
    type VisualizerMode,
} from '../../types';

// src/components/visualizer/complex.ts
// Owns the persisted visualizer complex schema and safe localStorage parsing.
export type VisualizerNodeRole = 'input' | 'visualizerBg' | 'visualizerMain' | 'visualizerOverlay' | 'output';

export type VisualizerInputKind = 'theme' | 'audio' | 'lyrics' | 'song' | 'playback';
export type VisualizerBgKind = 'solidTheme' | 'coverFluid' | 'geometric' | 'vignette';
export type VisualizerMainKind = 'mainRenderer';
export type VisualizerOverlayKind = 'subtitle';
export type VisualizerOutputKind = 'playerOutput';

export type VisualizerNodeKind =
    | VisualizerInputKind
    | VisualizerBgKind
    | VisualizerMainKind
    | VisualizerOverlayKind
    | VisualizerOutputKind;

export interface VisualizerNodePosition {
    x: number;
    y: number;
}

export interface VisualizerNodeBase {
    id: string;
    role: VisualizerNodeRole;
    kind: VisualizerNodeKind;
    label: string;
    enabled: boolean;
    position: VisualizerNodePosition;
}

export interface VisualizerInputNode extends VisualizerNodeBase {
    role: 'input';
    kind: VisualizerInputKind;
}

export interface VisualizerBgNode extends VisualizerNodeBase {
    role: 'visualizerBg';
    kind: VisualizerBgKind;
    config: {
        opacity?: number;
        useCoverColor?: boolean;
        hideShapes?: boolean;
    };
}

export interface VisualizerMainNode extends VisualizerNodeBase {
    role: 'visualizerMain';
    kind: 'mainRenderer';
    config: {
        mode: VisualizerMode;
        opacity?: number;
        lyricsFontScale?: number;
        cadenzaTuning?: CadenzaTuning;
        partitaTuning?: PartitaTuning;
        fumeTuning?: FumeTuning;
        cappellaTuning?: CappellaTuning;
        tiltTuning?: TiltTuning;
    };
}

export interface VisualizerOverlayNode extends VisualizerNodeBase {
    role: 'visualizerOverlay';
    kind: 'subtitle';
    config: {
        opacity?: number;
        hideTranslation?: boolean;
        translationFontSizeRem?: number;
        upcomingFontSizeRem?: number;
    };
}

export interface VisualizerOutputNode extends VisualizerNodeBase {
    role: 'output';
    kind: 'playerOutput';
}

export type VisualizerComplexNode =
    | VisualizerInputNode
    | VisualizerBgNode
    | VisualizerMainNode
    | VisualizerOverlayNode
    | VisualizerOutputNode;

export interface VisualizerComplexEdge {
    id: string;
    source: string;
    target: string;
}

export interface VisualizerComplexV1 {
    version: 1;
    nodes: VisualizerComplexNode[];
    edges: VisualizerComplexEdge[];
    output: {
        bgNodeIds: string[];
        mainNodeIds: string[];
        overlayNodeIds: string[];
    };
}

export const VISUALIZER_COMPLEX_STORAGE_KEY = 'visualizer_complex_v1';

const clampOpacity = (value: unknown, fallback: number) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const normalizeCadenzaTuning = (value: unknown): CadenzaTuning | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    return {
        fontScale: clampNumber(value.fontScale, DEFAULT_CADENZA_TUNING.fontScale, 0.6, 1.8),
        widthRatio: clampNumber(value.widthRatio, DEFAULT_CADENZA_TUNING.widthRatio, 0.4, 1),
        motionAmount: clampNumber(value.motionAmount, DEFAULT_CADENZA_TUNING.motionAmount, 0, 2),
        glowIntensity: clampNumber(value.glowIntensity, DEFAULT_CADENZA_TUNING.glowIntensity, 0, 2),
        beamIntensity: clampNumber(value.beamIntensity, DEFAULT_CADENZA_TUNING.beamIntensity, 0, 2),
    };
};

const normalizePartitaTuning = (value: unknown): PartitaTuning | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    const staggerMin = clampNumber(value.staggerMin, DEFAULT_PARTITA_TUNING.staggerMin, 0, 240);
    const staggerMax = clampNumber(value.staggerMax, DEFAULT_PARTITA_TUNING.staggerMax, 0, 320);
    return {
        showGuideLines: typeof value.showGuideLines === 'boolean' ? value.showGuideLines : DEFAULT_PARTITA_TUNING.showGuideLines,
        useSemanticLayout: typeof value.useSemanticLayout === 'boolean' ? value.useSemanticLayout : DEFAULT_PARTITA_TUNING.useSemanticLayout,
        staggerMin: Math.min(staggerMin, staggerMax),
        staggerMax: Math.max(staggerMin, staggerMax),
    };
};

const normalizeFumeTuning = (value: unknown): FumeTuning | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    return {
        hidePrintSymbols: typeof value.hidePrintSymbols === 'boolean' ? value.hidePrintSymbols : DEFAULT_FUME_TUNING.hidePrintSymbols,
        disableGeometricBackground: typeof value.disableGeometricBackground === 'boolean'
            ? value.disableGeometricBackground
            : DEFAULT_FUME_TUNING.disableGeometricBackground,
        backgroundObjectOpacity: clampNumber(value.backgroundObjectOpacity, DEFAULT_FUME_TUNING.backgroundObjectOpacity, 0, 1),
        textHoldRatio: clampNumber(value.textHoldRatio, DEFAULT_FUME_TUNING.textHoldRatio, 0, 1),
        cameraTrackingMode: value.cameraTrackingMode === 'stepped' || value.cameraTrackingMode === 'smooth'
            ? value.cameraTrackingMode
            : DEFAULT_FUME_TUNING.cameraTrackingMode,
        cameraSpeed: clampNumber(value.cameraSpeed, DEFAULT_FUME_TUNING.cameraSpeed, 0.55, 1.85),
        glowIntensity: clampNumber(value.glowIntensity, DEFAULT_FUME_TUNING.glowIntensity, 0, 1.8),
        heroScale: clampNumber(value.heroScale, DEFAULT_FUME_TUNING.heroScale, 0.82, 1.32),
    };
};

const normalizeCappellaTuning = (value: unknown): CappellaTuning | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    return {
        showEmoMessages: typeof value.showEmoMessages === 'boolean' ? value.showEmoMessages : DEFAULT_CAPPELLA_TUNING.showEmoMessages,
        emojiPackSource: value.emojiPackSource === 'custom' ? 'custom' : DEFAULT_CAPPELLA_TUNING.emojiPackSource,
        avatarSource: value.avatarSource === 'builtin' || value.avatarSource === 'color' || value.avatarSource === 'cover'
            ? value.avatarSource
            : DEFAULT_CAPPELLA_TUNING.avatarSource,
    };
};

const normalizeTiltTuning = (value: unknown): TiltTuning | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }

    const colorScheme = ['default', 'swap', 'accentAll', 'primaryAll'].includes(String(value.colorScheme))
        ? value.colorScheme as TiltTuning['colorScheme']
        : DEFAULT_TILT_TUNING.colorScheme;
    return {
        splitProbability: clampNumber(value.splitProbability, DEFAULT_TILT_TUNING.splitProbability, 0, 1),
        tiltStyleProbability: clampNumber(value.tiltStyleProbability, DEFAULT_TILT_TUNING.tiltStyleProbability, 0, 1),
        colorScheme,
    };
};

export const createDefaultVisualizerComplex = (): VisualizerComplexV1 => ({
    version: 1,
    nodes: [
        { id: 'input-theme', role: 'input', kind: 'theme', label: 'Theme', enabled: true, position: { x: 40, y: 40 } },
        { id: 'input-audio', role: 'input', kind: 'audio', label: 'Audio Bands', enabled: true, position: { x: 40, y: 150 } },
        { id: 'input-lyrics', role: 'input', kind: 'lyrics', label: 'Lyrics', enabled: true, position: { x: 40, y: 260 } },
        { id: 'input-song', role: 'input', kind: 'song', label: 'Song Metadata', enabled: true, position: { x: 40, y: 370 } },
        {
            id: 'bg-solid',
            role: 'visualizerBg',
            kind: 'solidTheme',
            label: 'Theme Background',
            enabled: true,
            position: { x: 330, y: 40 },
            config: { opacity: 1 },
        },
        {
            id: 'bg-geometric',
            role: 'visualizerBg',
            kind: 'geometric',
            label: 'Geometry',
            enabled: true,
            position: { x: 330, y: 170 },
            config: { opacity: 1, hideShapes: false },
        },
        {
            id: 'bg-vignette',
            role: 'visualizerBg',
            kind: 'vignette',
            label: 'Vignette',
            enabled: true,
            position: { x: 330, y: 300 },
            config: { opacity: 0.65 },
        },
        {
            id: 'main-classic',
            role: 'visualizerMain',
            kind: 'mainRenderer',
            label: 'Main Renderer',
            enabled: true,
            position: { x: 620, y: 150 },
            config: { mode: 'classic', opacity: 1 },
        },
        {
            id: 'overlay-subtitle',
            role: 'visualizerOverlay',
            kind: 'subtitle',
            label: 'Subtitle Overlay',
            enabled: true,
            position: { x: 620, y: 320 },
            config: { opacity: 0.6, hideTranslation: false },
        },
        { id: 'output-player', role: 'output', kind: 'playerOutput', label: 'Player Output', enabled: true, position: { x: 930, y: 210 } },
    ],
    edges: [
        { id: 'theme-solid', source: 'input-theme', target: 'bg-solid' },
        { id: 'theme-geometry', source: 'input-theme', target: 'bg-geometric' },
        { id: 'audio-geometry', source: 'input-audio', target: 'bg-geometric' },
        { id: 'lyrics-main', source: 'input-lyrics', target: 'main-classic' },
        { id: 'theme-main', source: 'input-theme', target: 'main-classic' },
        { id: 'lyrics-subtitle', source: 'input-lyrics', target: 'overlay-subtitle' },
        { id: 'bg-solid-output', source: 'bg-solid', target: 'output-player' },
        { id: 'bg-geometric-output', source: 'bg-geometric', target: 'output-player' },
        { id: 'bg-vignette-output', source: 'bg-vignette', target: 'output-player' },
        { id: 'main-output', source: 'main-classic', target: 'output-player' },
        { id: 'subtitle-output', source: 'overlay-subtitle', target: 'output-player' },
    ],
    output: {
        bgNodeIds: ['bg-solid', 'bg-geometric', 'bg-vignette'],
        mainNodeIds: ['main-classic'],
        overlayNodeIds: ['overlay-subtitle'],
    },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeNode = (node: unknown): VisualizerComplexNode | null => {
    if (!isRecord(node) || typeof node.id !== 'string' || typeof node.label !== 'string') {
        return null;
    }

    const base = {
        id: node.id,
        label: node.label,
        enabled: typeof node.enabled === 'boolean' ? node.enabled : true,
        position: isRecord(node.position)
            ? {
                x: Number.isFinite(Number(node.position.x)) ? Number(node.position.x) : 0,
                y: Number.isFinite(Number(node.position.y)) ? Number(node.position.y) : 0,
            }
            : { x: 0, y: 0 },
    };

    if (node.role === 'input' && ['theme', 'audio', 'lyrics', 'song', 'playback'].includes(String(node.kind))) {
        return { ...base, role: 'input', kind: node.kind as VisualizerInputKind };
    }

    if (node.role === 'visualizerBg' && ['solidTheme', 'coverFluid', 'geometric', 'vignette'].includes(String(node.kind))) {
        const config = isRecord(node.config) ? node.config : {};
        return {
            ...base,
            role: 'visualizerBg',
            kind: node.kind as VisualizerBgKind,
            config: {
                opacity: clampOpacity(config.opacity, 1),
                useCoverColor: typeof config.useCoverColor === 'boolean' ? config.useCoverColor : undefined,
                hideShapes: typeof config.hideShapes === 'boolean' ? config.hideShapes : undefined,
            },
        };
    }

    if (node.role === 'visualizerMain' && node.kind === 'mainRenderer') {
        const config = isRecord(node.config) ? node.config : {};
        return {
            ...base,
            role: 'visualizerMain',
            kind: 'mainRenderer',
            config: {
                mode: typeof config.mode === 'string' ? config.mode as VisualizerMode : 'classic',
                opacity: clampOpacity(config.opacity, 1),
                lyricsFontScale: config.lyricsFontScale === undefined
                    ? undefined
                    : clampNumber(config.lyricsFontScale, 1, 0.6, 1.8),
                cadenzaTuning: normalizeCadenzaTuning(config.cadenzaTuning),
                partitaTuning: normalizePartitaTuning(config.partitaTuning),
                fumeTuning: normalizeFumeTuning(config.fumeTuning),
                cappellaTuning: normalizeCappellaTuning(config.cappellaTuning),
                tiltTuning: normalizeTiltTuning(config.tiltTuning),
            },
        };
    }

    if (node.role === 'visualizerOverlay' && node.kind === 'subtitle') {
        const config = isRecord(node.config) ? node.config : {};
        return {
            ...base,
            role: 'visualizerOverlay',
            kind: 'subtitle',
            config: {
                opacity: clampOpacity(config.opacity, 0.6),
                hideTranslation: typeof config.hideTranslation === 'boolean' ? config.hideTranslation : false,
                translationFontSizeRem: config.translationFontSizeRem === undefined
                    ? undefined
                    : clampNumber(config.translationFontSizeRem, 1.1, 0.7, 1.8),
                upcomingFontSizeRem: config.upcomingFontSizeRem === undefined
                    ? undefined
                    : clampNumber(config.upcomingFontSizeRem, 0.95, 0.6, 1.4),
            },
        };
    }

    if (node.role === 'output' && node.kind === 'playerOutput') {
        return { ...base, role: 'output', kind: 'playerOutput' };
    }

    return null;
};

const normalizeEdge = (edge: unknown): VisualizerComplexEdge | null => {
    if (!isRecord(edge) || typeof edge.id !== 'string' || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
        return null;
    }

    return { id: edge.id, source: edge.source, target: edge.target };
};

const appendUnique = (ids: string[], id: string) => {
    if (!ids.includes(id)) {
        ids.push(id);
    }
};

// Keeps stored output aligned with the persisted graph edges instead of trusting stale UI state.
const deriveOutputFromEdges = (
    nodes: VisualizerComplexNode[],
    edges: VisualizerComplexEdge[],
): VisualizerComplexV1['output'] => {
    const output: VisualizerComplexV1['output'] = {
        bgNodeIds: [],
        mainNodeIds: [],
        overlayNodeIds: [],
    };
    const nodesById = new Map(nodes.map(node => [node.id, node]));
    const outputNodeIds = new Set(nodes.filter(node => node.role === 'output' && node.enabled).map(node => node.id));

    edges.forEach(edge => {
        if (!outputNodeIds.has(edge.target)) {
            return;
        }

        const sourceNode = nodesById.get(edge.source);
        if (!sourceNode?.enabled) {
            return;
        }

        if (sourceNode.role === 'visualizerBg') {
            appendUnique(output.bgNodeIds, sourceNode.id);
            return;
        }

        if (sourceNode.role === 'visualizerMain') {
            appendUnique(output.mainNodeIds, sourceNode.id);
            return;
        }

        if (sourceNode.role === 'visualizerOverlay') {
            appendUnique(output.overlayNodeIds, sourceNode.id);
        }
    });

    return output;
};

export const normalizeVisualizerComplex = (value: unknown): VisualizerComplexV1 => {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes)) {
        return createDefaultVisualizerComplex();
    }

    const nodes = value.nodes.map(normalizeNode).filter((node): node is VisualizerComplexNode => Boolean(node));
    if (nodes.length === 0) {
        return createDefaultVisualizerComplex();
    }

    const nodeIds = new Set(nodes.map(node => node.id));
    const edges = Array.isArray(value.edges)
        ? value.edges.map(normalizeEdge).filter((edge): edge is VisualizerComplexEdge => Boolean(edge && nodeIds.has(edge.source) && nodeIds.has(edge.target)))
        : [];

    return {
        version: 1,
        nodes,
        edges,
        output: deriveOutputFromEdges(nodes, edges),
    };
};

export const readStoredVisualizerComplex = (): VisualizerComplexV1 => {
    if (typeof window === 'undefined') {
        return createDefaultVisualizerComplex();
    }

    const saved = localStorage.getItem(VISUALIZER_COMPLEX_STORAGE_KEY);
    if (!saved) {
        return createDefaultVisualizerComplex();
    }

    try {
        return normalizeVisualizerComplex(JSON.parse(saved));
    } catch {
        return createDefaultVisualizerComplex();
    }
};

export const writeStoredVisualizerComplex = (complex: VisualizerComplexV1) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(VISUALIZER_COMPLEX_STORAGE_KEY, JSON.stringify(normalizeVisualizerComplex(complex)));
    }
};

export const getOrderedComplexNodes = <T extends VisualizerComplexNode['role']>(
    complex: VisualizerComplexV1,
    role: T,
    orderedIds: string[],
) => {
    const nodesById = new Map(complex.nodes.map(node => [node.id, node]));
    return orderedIds
        .map(id => nodesById.get(id))
        .filter((node): node is Extract<VisualizerComplexNode, { role: T }> => Boolean(node && node.role === role && node.enabled));
};
