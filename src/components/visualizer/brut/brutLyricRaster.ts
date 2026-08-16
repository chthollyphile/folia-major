import * as THREE from 'three';
import { BRUT_RASTER_FONT_PX, BRUT_RASTER_MAX_CANVAS_PX } from './brutConstants';
import { type BrutInstallUnit } from './brutLyricUnits';

// src/components/visualizer/brut/brutLyricRaster.ts
// One canvas per lyric line: an ATLAS with a padded cell per install unit.
//
// The units are scattered over the wall, not laid out along a line, so the raster does not draw the
// sentence continuously. Drawing it continuously and then slicing it is what makes neighbouring
// glyphs bleed into each cell - CJK glyphs sit flush at one em, so any slice padding immediately
// eats the character next door. Each unit therefore gets its own fillText into its own cell with
// real empty space around it, which makes a cell's contents exact by construction.
//
// Shaping still comes from the browser: a unit (a latin word, a CJK character, a token plus its
// sticky punctuation) is drawn in ONE fillText, so kerning, ligatures, combining marks and
// per-glyph font fallback inside the unit stay intact. Only cross-unit kerning is lost, and
// scattered tokens have no cross-unit kerning to preserve.

const CELL_PAD_EM = 0.16;
const BAND_EM = 1.4;

export interface BrutUnitRect {
    /** UV sub-rect of this unit's atlas cell. */
    u0: number;
    u1: number;
    v0: number;
    v1: number;
    /** Cell width in em; the quad uses this against bandEm so a cell is never distorted. */
    widthEm: number;
}

export interface BrutLineRaster {
    texture: THREE.CanvasTexture;
    fontPx: number;
    /** Atlas extent in em. Layout uses the per-unit rects, not these. */
    widthEm: number;
    heightEm: number;
    /** Height of one atlas row in em; every unit plate is this tall. */
    bandEm: number;
    rects: BrutUnitRect[];
    dispose: () => void;
}

let measureContext: CanvasRenderingContext2D | null = null;
const getMeasureContext = (): CanvasRenderingContext2D => {
    if (!measureContext) {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        measureContext = canvas.getContext('2d')!;
    }
    return measureContext;
};

export const buildBrutFontSpec = (fontStack: string, fontWeight: number, fontPx: number): string => (
    `${fontWeight} ${fontPx}px ${fontStack}`
);

const measure = (text: string, fontSpec: string): number => {
    const context = getMeasureContext();
    context.font = fontSpec;
    return context.measureText(text).width;
};

interface AtlasCell {
    x: number;
    row: number;
    width: number;
}

interface AtlasPlan {
    cells: AtlasCell[];
    rows: number;
    width: number;
}

/** Packs one cell per unit into rows no wider than the max canvas edge. */
const planAtlas = (units: BrutInstallUnit[], fontSpec: string, pad: number, maxWidth: number): AtlasPlan => {
    const cells: AtlasCell[] = new Array(units.length);
    let row = 0;
    let cursor = 0;
    let widest = 1;

    units.forEach((unit, index) => {
        const width = Math.max(1, measure(unit.text, fontSpec)) + pad * 2;
        if (cursor > 0 && cursor + width > maxWidth) {
            row += 1;
            cursor = 0;
        }
        cells[index] = { x: cursor, row, width };
        cursor += width;
        widest = Math.max(widest, cursor);
    });

    return { cells, rows: row + 1, width: widest };
};

/** Rasterises one line into a per-unit atlas and resolves each unit's cell. */
export const rasterBrutLine = (
    units: BrutInstallUnit[],
    fontStack: string,
    fontWeight: number,
): BrutLineRaster => {
    let fontPx = BRUT_RASTER_FONT_PX;
    let fontSpec = buildBrutFontSpec(fontStack, fontWeight, fontPx);
    let pad = fontPx * CELL_PAD_EM;
    let plan = planAtlas(units, fontSpec, pad, BRUT_RASTER_MAX_CANVAS_PX);

    // A long line spills into extra rows; shrink the em only if the atlas would still overflow.
    if (plan.rows * fontPx * BAND_EM > BRUT_RASTER_MAX_CANVAS_PX) {
        const shrink = BRUT_RASTER_MAX_CANVAS_PX / (plan.rows * fontPx * BAND_EM);
        fontPx = Math.max(28, Math.floor(fontPx * Math.sqrt(shrink)));
        fontSpec = buildBrutFontSpec(fontStack, fontWeight, fontPx);
        pad = fontPx * CELL_PAD_EM;
        plan = planAtlas(units, fontSpec, pad, BRUT_RASTER_MAX_CANVAS_PX);
    }

    const bandPx = fontPx * BAND_EM;
    const canvasWidth = Math.max(1, Math.ceil(plan.width));
    const canvasHeight = Math.max(1, Math.ceil(bandPx * plan.rows));

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d')!;
    context.font = fontSpec;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';

    const rects: BrutUnitRect[] = new Array(units.length);
    units.forEach((unit, index) => {
        const cell = plan.cells[index];
        context.fillText(unit.text, cell.x + pad, bandPx * (cell.row + 0.5));

        // CanvasTexture flips Y, so atlas row 0 sits at v = 1.
        rects[index] = {
            u0: cell.x / canvasWidth,
            u1: (cell.x + cell.width) / canvasWidth,
            v0: 1 - (cell.row + 1) / plan.rows,
            v1: 1 - cell.row / plan.rows,
            widthEm: cell.width / fontPx,
        };
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;

    return {
        texture,
        fontPx,
        widthEm: canvasWidth / fontPx,
        heightEm: canvasHeight / fontPx,
        bandEm: BAND_EM,
        rects,
        dispose: () => texture.dispose(),
    };
};
