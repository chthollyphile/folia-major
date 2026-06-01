import type { VisualizerComplexNode, VisualizerInputKind, VisualizerNodeRole } from './complex';

// src/components/visualizer/portRegistry.ts
// Central typed port definitions shared by the complex schema, React Flow UI, and runtime resolver.
export type VisualizerPortDataType =
    | 'color'
    | 'lyricLines'
    | 'audioPower'
    | 'audioBands'
    | 'motionTime'
    | 'string'
    | 'url'
    | 'visualLayer';

export interface VisualizerPortDefinition {
    id: string;
    label: string;
    dataType: VisualizerPortDataType;
    direction: 'source' | 'target';
}

const THEME_COLOR_SOURCE_PORTS: VisualizerPortDefinition[] = [
    { id: 'theme.backgroundColor', label: '背景色', dataType: 'color', direction: 'source' },
    { id: 'theme.primaryColor', label: '主文字色', dataType: 'color', direction: 'source' },
    { id: 'theme.accentColor', label: '强调色', dataType: 'color', direction: 'source' },
    { id: 'theme.secondaryColor', label: '辅助色', dataType: 'color', direction: 'source' },
];

const THEME_COLOR_TARGET_PORTS: VisualizerPortDefinition[] = [
    { id: 'theme.backgroundColor', label: '背景色', dataType: 'color', direction: 'target' },
    { id: 'theme.primaryColor', label: '主文字色', dataType: 'color', direction: 'target' },
    { id: 'theme.accentColor', label: '强调色', dataType: 'color', direction: 'target' },
    { id: 'theme.secondaryColor', label: '辅助色', dataType: 'color', direction: 'target' },
];

export const INPUT_SOURCE_PORTS: Record<VisualizerInputKind, VisualizerPortDefinition[]> = {
    theme: THEME_COLOR_SOURCE_PORTS,
    audio: [
        { id: 'audio.power', label: '音频能量', dataType: 'audioPower', direction: 'source' },
        { id: 'audio.bands', label: '频段组', dataType: 'audioBands', direction: 'source' },
    ],
    lyrics: [
        { id: 'lyrics.lines', label: '原文歌词', dataType: 'lyricLines', direction: 'source' },
        { id: 'lyrics.translationLines', label: '翻译歌词', dataType: 'lyricLines', direction: 'source' },
    ],
    song: [
        { id: 'song.title', label: '歌曲标题', dataType: 'string', direction: 'source' },
        { id: 'song.coverUrl', label: '封面 URL', dataType: 'url', direction: 'source' },
    ],
    playback: [
        { id: 'playback.currentTime', label: '播放时间', dataType: 'motionTime', direction: 'source' },
    ],
};

const OUTPUT_TARGET_PORT: VisualizerPortDefinition = {
    id: 'output.visualLayer',
    label: '画面层',
    dataType: 'visualLayer',
    direction: 'target',
};

const VISUAL_LAYER_SOURCE_PORT: VisualizerPortDefinition = {
    id: 'layer.visual',
    label: '视觉层',
    dataType: 'visualLayer',
    direction: 'source',
};

const COMMON_RENDER_TARGET_PORTS: VisualizerPortDefinition[] = [
    ...THEME_COLOR_TARGET_PORTS,
    { id: 'lyrics.lines', label: '歌词行', dataType: 'lyricLines', direction: 'target' },
    { id: 'playback.currentTime', label: '时间', dataType: 'motionTime', direction: 'target' },
    { id: 'audio.power', label: '音频能量', dataType: 'audioPower', direction: 'target' },
    { id: 'audio.bands', label: '频段组', dataType: 'audioBands', direction: 'target' },
    { id: 'song.title', label: '标题', dataType: 'string', direction: 'target' },
    { id: 'song.coverUrl', label: '封面 URL', dataType: 'url', direction: 'target' },
];

export const getNodeSourcePorts = (node: VisualizerComplexNode): VisualizerPortDefinition[] => {
    if (node.role === 'input') {
        return INPUT_SOURCE_PORTS[node.kind];
    }

    if (node.role === 'visualizerBg' || node.role === 'visualizerMain' || node.role === 'visualizerOverlay') {
        return [VISUAL_LAYER_SOURCE_PORT];
    }

    return [];
};

export const getNodeTargetPorts = (node: VisualizerComplexNode): VisualizerPortDefinition[] => {
    if (node.role === 'visualizerBg' || node.role === 'visualizerMain') {
        return COMMON_RENDER_TARGET_PORTS;
    }

    if (node.role === 'visualizerOverlay') {
        return COMMON_RENDER_TARGET_PORTS;
    }

    if (node.role === 'output') {
        return [OUTPUT_TARGET_PORT];
    }

    return [];
};

export const getPortsForRoleAndKind = (
    role: VisualizerNodeRole,
    kind: string,
): { sourcePorts: VisualizerPortDefinition[]; targetPorts: VisualizerPortDefinition[]; } => {
    if (role === 'input' && kind in INPUT_SOURCE_PORTS) {
        return {
            sourcePorts: INPUT_SOURCE_PORTS[kind as VisualizerInputKind],
            targetPorts: [],
        };
    }

    if (role === 'output') {
        return { sourcePorts: [], targetPorts: [OUTPUT_TARGET_PORT] };
    }

    if (role === 'visualizerBg' || role === 'visualizerMain' || role === 'visualizerOverlay') {
        return {
            sourcePorts: [VISUAL_LAYER_SOURCE_PORT],
            targetPorts: COMMON_RENDER_TARGET_PORTS,
        };
    }

    return { sourcePorts: [], targetPorts: [] };
};

export const canConnectPorts = (
    sourceNode: VisualizerComplexNode | undefined,
    sourceHandle: string | null | undefined,
    targetNode: VisualizerComplexNode | undefined,
    targetHandle: string | null | undefined,
) => {
    if (!sourceNode || !targetNode || !sourceHandle || !targetHandle || sourceNode.id === targetNode.id) {
        return false;
    }

    const sourcePort = getNodeSourcePorts(sourceNode).find(port => port.id === sourceHandle);
    const targetPort = getNodeTargetPorts(targetNode).find(port => port.id === targetHandle);
    return Boolean(sourcePort && targetPort && sourcePort.dataType === targetPort.dataType);
};

export const getPortLabel = (
    node: VisualizerComplexNode | undefined,
    handleId: string | null | undefined,
    direction: 'source' | 'target',
) => {
    if (!node || !handleId) {
        return handleId ?? '';
    }

    const ports = direction === 'source' ? getNodeSourcePorts(node) : getNodeTargetPorts(node);
    return ports.find(port => port.id === handleId)?.label ?? handleId;
};
