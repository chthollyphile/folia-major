import React from 'react';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PonderSurfaceContents from '@/components/ponder/PonderSurfaceContents';
import type { PonderRelativeRect, PonderSurfaceKind } from '@/types/ponder';

// test/unit/ponder/ponderSurfacePins.test.ts
// Pins what the stand-ins are made of: every number of their size tables, and the drawing each
// kind gets.
//
// A lesson's highlight lands where a size table says; a wrong number there breaks nothing that a
// build sees, the frame just sits beside the part it names. These pins were recorded while all the
// sizes were one table and one conditional picked the drawing. They read the size tables by a file
// pattern and the drawings through PonderSurfaceContents, so that they pass unchanged when the
// table and the conditional are split up: a pin that has to change means the split moved something.

/** Every data module under surfaces/ (the drawings are .tsx and are not matched). */
const dataModules = import.meta.glob<Record<string, unknown>>(
    '/src/components/ponder/surfaces/**/*.ts',
    { eager: true },
);

/** All their exports under one roof. A name exported twice would hide one of the two. */
const collectExports = () => {
    const all: Record<string, unknown> = {};
    for (const [path, module] of Object.entries(dataModules)) {
        for (const [name, value] of Object.entries(module)) {
            if (name in all) {
                throw new Error(`"${name}" is exported twice (second time by ${path})`);
            }
            all[name] = value;
        }
    }
    return all;
};

const sortByKey = <T,>(record: Record<string, T>): Record<string, T> => (
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
);

const KINDS = [
    'plain', 'palette', 'picker', 'queue', 'volume', 'grid-page', 'grid-view-page', 'local-grid-map',
    'player-page', 'lattice-page', 'settings-page', 'player-bar', 'ponder-onboarding', 'bottom-ui-settings',
    'side-panel', 'lattice-chrome', 'lyrics-animation-settings', 'theme-settings', 'grid3d-card-style',
    'grid-view-card-settings', 'lattice-style-settings', 'grid-action-button', 'grid-view-cards',
    'local-folder-actions', 'local-track-list', 'local-grid-controls', 'online-collection-actions',
    'desktop-features', 'queue-command', 'transition-settings', 'library-watch-settings', 'queue-settings',
    'lyrics-source-settings', 'grid-hotkey-settings', 'custom-shortcut-settings', 'pinned-commands-settings',
    'replay-gain-settings', 'import-export-settings', 'audio-equalizer', 'vis-playground', 'theme-park',
    'lyric-style', 'lyric-export', 'sign-in', 'lyric-match', 'scratchpad',
] as const satisfies readonly PonderSurfaceKind[];

const drawingOf = (kind: PonderSurfaceKind | undefined) => {
    const markup = renderToStaticMarkup(
        React.createElement(PonderSurfaceContents, {
            kind,
            accent: '#ff3366',
            line: 'rgba(255,255,255,0.1)',
            outline: 'rgba(255,255,255,0.2)',
        }),
    );
    return `${markup.length} ${createHash('sha256').update(markup).digest('hex').slice(0, 16)}`;
};

describe('the stand-ins as recorded before the size table was split', () => {
    it('every size table gives the same numbers', () => {
        const all = collectExports();
        const tables = Object.fromEntries(
            Object.entries(all).map(([name, value]) => [name, typeof value === 'function' ? '(function)' : value]),
        );
        expect(sortByKey(tables)).toMatchSnapshot();
    });

    it('the two size functions give the same results', () => {
        const all = collectExports();
        const gridViewCardRect = all.gridViewCardRect as (index: number) => PonderRelativeRect;
        const relativeRectStyle = all.relativeRectStyle as (rect: PonderRelativeRect) => Record<string, unknown>;
        expect(Array.from({ length: 18 }, (_, index) => gridViewCardRect(index))).toMatchSnapshot();
        expect([
            { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
            { right: 0.1, bottom: 0.2, width: 0.3, height: 0.4 },
            { left: 0.1, right: 0.2, top: 0.3, bottom: 0.4 },
            { left: 0.1, top: 0.2, width: 0.3, square: true },
            { left: 0.1, top: 0.2, width: 0.3, aspect: 0.5 },
            { left: 0.1, top: 0.2, width: 0.3, height: 0.4, square: true },
            { left: 0, top: 0, width: 1, height: 1 },
        ].map(relativeRectStyle)).toMatchSnapshot();
    });

    it('every kind gets the same drawing', () => {
        const drawings: Record<string, string> = { '(none given)': drawingOf(undefined) };
        for (const kind of KINDS) {
            drawings[kind] = drawingOf(kind);
        }
        expect(drawings).toMatchSnapshot();
    });
});
