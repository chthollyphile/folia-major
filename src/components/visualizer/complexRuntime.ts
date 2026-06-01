import type { MotionValue } from 'framer-motion';
import type { AudioBands, Line, Theme } from '../../types';
import type { VisualizerSharedProps } from './definition';
import type { VisualizerComplexNode, VisualizerComplexV1 } from './complex';

// src/components/visualizer/complexRuntime.ts
// Resolves typed visEditor port connections into node-local renderer props.
export interface VisualizerComplexBaseInputs extends VisualizerSharedProps {}

type PortValue = string | Line[] | MotionValue<number> | AudioBands | null | undefined;

const createCharacterWords = (text: string, startTime: number, endTime: number) => {
    const chars = Array.from(text);
    const duration = Math.max(0.001, endTime - startTime);

    return chars.map((char, index) => ({
        text: char,
        startTime: startTime + duration * (index / Math.max(1, chars.length)),
        endTime: startTime + duration * ((index + 1) / Math.max(1, chars.length)),
    }));
};

// Converts aligned line translations into ordinary Line objects so existing visualizers can consume them unchanged.
export const createTranslationLines = (lines: Line[]): Line[] => lines.map(line => {
    const text = line.translation?.trim() || line.fullText;
    return {
        ...line,
        fullText: text,
        translation: text,
        words: createCharacterWords(text, line.startTime, line.endTime),
    };
});

const resolveSourceValue = (
    handleId: string,
    baseInputs: VisualizerComplexBaseInputs,
    translationLines: Line[],
): PortValue => {
    if (handleId === 'theme.backgroundColor') return baseInputs.theme.backgroundColor;
    if (handleId === 'theme.primaryColor') return baseInputs.theme.primaryColor;
    if (handleId === 'theme.accentColor') return baseInputs.theme.accentColor;
    if (handleId === 'theme.secondaryColor') return baseInputs.theme.secondaryColor;
    if (handleId === 'lyrics.lines') return baseInputs.lines;
    if (handleId === 'lyrics.translationLines') return translationLines;
    if (handleId === 'audio.power') return baseInputs.audioPower;
    if (handleId === 'audio.bands') return baseInputs.audioBands;
    if (handleId === 'playback.currentTime') return baseInputs.currentTime;
    if (handleId === 'song.title') return baseInputs.songTitle;
    if (handleId === 'song.coverUrl') return baseInputs.coverUrl;
    return undefined;
};

const applyTargetValue = (
    props: VisualizerComplexBaseInputs,
    targetHandle: string,
    value: PortValue,
): VisualizerComplexBaseInputs => {
    if (value === undefined || value === null) {
        return props;
    }

    if (targetHandle.startsWith('theme.') && typeof value === 'string') {
        const themeKey = targetHandle.slice('theme.'.length) as keyof Pick<Theme, 'backgroundColor' | 'primaryColor' | 'accentColor' | 'secondaryColor'>;
        return {
            ...props,
            theme: {
                ...props.theme,
                [themeKey]: value,
            },
        };
    }

    if (targetHandle === 'lyrics.lines' && Array.isArray(value)) {
        return { ...props, lines: value };
    }

    if (targetHandle === 'audio.power') {
        return { ...props, audioPower: value as MotionValue<number> };
    }

    if (targetHandle === 'audio.bands') {
        return { ...props, audioBands: value as AudioBands };
    }

    if (targetHandle === 'playback.currentTime') {
        return { ...props, currentTime: value as MotionValue<number> };
    }

    if (targetHandle === 'song.title' && typeof value === 'string') {
        return { ...props, songTitle: value };
    }

    if (targetHandle === 'song.coverUrl' && typeof value === 'string') {
        return { ...props, coverUrl: value };
    }

    return props;
};

export const resolveVisualizerNodeProps = (
    complex: VisualizerComplexV1,
    node: VisualizerComplexNode,
    baseInputs: VisualizerComplexBaseInputs,
): VisualizerComplexBaseInputs => {
    const nodesById = new Map(complex.nodes.map(existing => [existing.id, existing]));
    const translationLines = createTranslationLines(baseInputs.lines);

    return complex.edges
        .filter(edge => edge.target === node.id)
        .reduce<VisualizerComplexBaseInputs>((props, edge) => {
            const sourceNode = nodesById.get(edge.source);
            if (sourceNode?.role !== 'input') {
                return props;
            }

            return applyTargetValue(
                props,
                edge.targetHandle,
                resolveSourceValue(edge.sourceHandle, baseInputs, translationLines),
            );
        }, baseInputs);
};
