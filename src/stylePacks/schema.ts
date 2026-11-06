import { STYLE_KINDS, LYRIC_TEMPLATE_IDS } from './catalog.ts';

// JSON Schema is the single validation source used in the app and published to agents.
const color = { type: 'string', pattern: '^(#[0-9a-fA-F]{6}|@(background|primary|secondary|accent))$' };
const number = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const choice = (...values: string[]) => ({ type: 'string', enum: values });
const layer = {
    type: 'object', additionalProperties: false,
    required: ['id', 'kind', 'x', 'y', 'width', 'height', 'color'],
    properties: {
        id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' },
        kind: choice('rect', 'ellipse', 'cover', 'text', 'lyrics', 'progress', 'spectrum'),
        x: number(0, 100), y: number(0, 100), width: number(0.1, 100), height: number(0.1, 100),
        color, opacity: number(0, 1), radius: number(0, 50), fontSize: number(1, 16),
        align: choice('left', 'center', 'right'),
        source: choice('title', 'artist', 'album', 'literal', 'current', 'previous', 'next', 'translation'),
        text: { type: 'string', maxLength: 200 },
        motion: {
            type: 'object', additionalProperties: false, required: ['kind', 'amount', 'period', 'signal'],
            properties: { kind: choice('float', 'pulse', 'rotate'), amount: number(0, 30), period: number(0.5, 120), signal: choice('time', 'audio') },
        },
    },
};
export const STYLE_PACK_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Folia Style Pack v1', type: 'object', additionalProperties: false,
    required: ['format', 'schemaVersion', 'id', 'name', 'version', 'author', 'palette', 'layers'],
    properties: {
        format: { const: 'folia-style' }, schemaVersion: { const: 1 },
        id: { type: 'string', pattern: '^[a-z][a-z0-9.-]{2,63}$' },
        name: { type: 'string', minLength: 1, maxLength: 80 },
        author: { type: 'string', minLength: 1, maxLength: 80 },
        version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
        description: { type: 'string', maxLength: 400 },
        kind: choice(...STYLE_KINDS),
        lyricTemplate: choice(...LYRIC_TEMPLATE_IDS),
        palette: {
            type: 'object', additionalProperties: false, required: ['background', 'primary', 'secondary', 'accent'],
            properties: { background: color, primary: color, secondary: color, accent: color },
        },
        layers: { type: 'array', minItems: 1, maxItems: 32, items: layer },
        portraitLayers: { type: 'array', minItems: 1, maxItems: 32, items: layer },
    },
};
