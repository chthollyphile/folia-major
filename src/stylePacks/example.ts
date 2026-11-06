import type { PackLayer, StylePack } from './types';

// The bundled reference pack is also the recovery default and agent starter template.
const text = (id: string, source: PackLayer['source'], x: number, y: number, width: number, height: number, fontSize: number, color: string): PackLayer => ({ id, kind: 'text', source, x, y, width, height, fontSize, color });
export const EXAMPLE_PACK: StylePack = {
    format: 'folia-style', schemaVersion: 1, id: 'folia.nocturne', name: 'Nocturne', version: '1.0.0', author: 'Folia',
    description: 'A cover-led listening room, with responsive lyrics and an audio-reactive halo.',
    palette: { background: '@background', primary: '@primary', secondary: '@secondary', accent: '@accent' },
    layers: [
        { id: 'halo', kind: 'ellipse', x: 4, y: 10, width: 43, height: 76, color: '@accent', opacity: 0.12, motion: { kind: 'pulse', signal: 'audio', amount: 8, period: 4 } },
        { id: 'cover', kind: 'cover', x: 9, y: 20, width: 32, height: 57, radius: 3, color: '@secondary' },
        { ...text('label', 'literal', 48, 18, 43, 5, 1.8, '@accent'), text: 'F O L I A  /  N O C T U R N E' },
        text('title', 'title', 48, 27, 43, 13, 5, '@primary'),
        text('artist', 'artist', 48, 41, 43, 5, 2.2, '@secondary'),
        { ...text('lyrics', 'current', 48, 53, 43, 16, 3.5, '@primary'), kind: 'lyrics' },
        { ...text('translation', 'translation', 48, 70, 43, 7, 2, '@secondary'), kind: 'lyrics' },
        { id: 'spectrum', kind: 'spectrum', x: 48, y: 80, width: 43, height: 4, color: '@accent' },
        { id: 'progress', kind: 'progress', x: 9, y: 91, width: 82, height: 0.5, color: '@accent' },
    ],
    portraitLayers: [
        { id: 'cover', kind: 'cover', x: 18, y: 8, width: 64, height: 34, radius: 3, color: '@secondary' },
        { ...text('title', 'title', 8, 45, 84, 9, 5, '@primary'), align: 'center' },
        { ...text('artist', 'artist', 8, 55, 84, 5, 3, '@secondary'), align: 'center' },
        { ...text('lyrics', 'current', 8, 64, 84, 16, 5, '@primary'), kind: 'lyrics', align: 'center' },
        { ...text('translation', 'translation', 8, 81, 84, 7, 3, '@secondary'), kind: 'lyrics', align: 'center' },
        { id: 'progress', kind: 'progress', x: 8, y: 92, width: 84, height: 0.5, color: '@accent' },
    ],
};
