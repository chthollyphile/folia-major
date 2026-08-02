import type { Theme } from '../../../types';
import type { GlyphView } from './sonnetTextViewBuilder';
import type { SonnetTypographyPlacement } from './sonnetTypographyLayout';
import {
    LA_FOLIA_CYCLE_SECONDS,
    LA_FOLIA_STAFF_NOTES,
    LA_FOLIA_TOTAL_BEATS,
    type SonnetStaffNote,
} from './sonnetStaffNotation';

// src/components/visualizer/sonnet/sonnetStaffView.ts
type PixiModule = typeof import('pixi.js');

interface TimedSonnetStaffNote extends SonnetStaffNote {
    startBeat: number;
}

const positiveModulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

export const buildSonnetStaffView = (
    pixi: PixiModule,
    placement: SonnetTypographyPlacement,
    theme: Theme,
    baseFontSize: number,
    shotStartTime: number,
    width: number,
    containerLayer: import('pixi.js').Container,
): GlyphView & { updateAnimation: (time: number) => void } => {
    const wrapper = new pixi.Container();
    wrapper.rotation = placement.rotation;
    wrapper.position.set(placement.x, placement.y);
    wrapper.alpha = 0;

    const staffWidth = Math.max(300, width * 0.6);
    const lineSpacing = baseFontSize * 0.25;
    const totalHeight = lineSpacing * 4;
    const halfWidth = staffWidth / 2;
    const halfHeight = totalHeight / 2;
    const playableWidth = staffWidth * 0.92;
    const beatWidth = playableWidth / LA_FOLIA_TOTAL_BEATS;
    const timedNotes: TimedSonnetStaffNote[] = [];
    let beatCursor = 0;
    for (const note of LA_FOLIA_STAFF_NOTES) {
        timedNotes.push({ ...note, startBeat: beatCursor });
        beatCursor += note.beats;
    }

    const primaryColor = pixi.Color.shared.setValue(theme.primaryColor).toNumber();
    const accentColor = pixi.Color.shared.setValue(theme.accentColor).toNumber();

    const staffGraphics = new pixi.Graphics();
    
    // Draw 5 staff lines
    for (let i = 0; i < 5; i++) {
        const y = -halfHeight + i * lineSpacing;
        staffGraphics.moveTo(-halfWidth, y);
        staffGraphics.lineTo(halfWidth, y);
    }
    staffGraphics.stroke({ color: primaryColor, width: 2, alpha: 0.3 });

    // Keep the written 3/4 bar structure visible while the notes loop independently.
    for (let bar = 1; bar < 8; bar += 1) {
        const x = -playableWidth / 2 + beatWidth * bar * 3;
        staffGraphics.moveTo(x, -halfHeight);
        staffGraphics.lineTo(x, halfHeight);
    }
    staffGraphics.stroke({ color: primaryColor, width: 1, alpha: 0.16 });

    // Decorative clef/bar lines
    staffGraphics.moveTo(-halfWidth + 10, -halfHeight);
    staffGraphics.lineTo(-halfWidth + 10, halfHeight);
    staffGraphics.stroke({ color: primaryColor, width: 4, alpha: 0.5 });

    staffGraphics.moveTo(halfWidth - 10, -halfHeight);
    staffGraphics.lineTo(halfWidth - 10, halfHeight);
    staffGraphics.stroke({ color: primaryColor, width: 2, alpha: 0.5 });
    staffGraphics.moveTo(halfWidth - 4, -halfHeight);
    staffGraphics.lineTo(halfWidth - 4, halfHeight);
    staffGraphics.stroke({ color: primaryColor, width: 6, alpha: 0.5 });

    const noteGraphics = new pixi.Graphics();
    wrapper.addChild(staffGraphics, noteGraphics);
    
    containerLayer.addChild(wrapper);

    /** Draws the fixed La Folia phrase and advances its playback cursor on a normal time loop. */
    const updateAnimation = (time: number) => {
        const cycleElapsed = positiveModulo(time - shotStartTime, LA_FOLIA_CYCLE_SECONDS);
        const beatPosition = (cycleElapsed / LA_FOLIA_CYCLE_SECONDS) * LA_FOLIA_TOTAL_BEATS;
        const cursorX = -playableWidth / 2 + beatWidth * beatPosition;

        noteGraphics.clear();
        noteGraphics.moveTo(cursorX, -halfHeight - lineSpacing * 0.8);
        noteGraphics.lineTo(cursorX, halfHeight + lineSpacing * 0.8);
        noteGraphics.stroke({ color: accentColor, width: 1.5, alpha: 0.34 });

        timedNotes.forEach((note, index) => {
            const isActive = beatPosition >= note.startBeat
                && beatPosition < note.startBeat + note.beats;
            const pulse = isActive
                ? (Math.sin(cycleElapsed * Math.PI * 5 + index * 0.4) + 1) * 0.5
                : 0;
            const noteScale = isActive ? 1 + pulse * 0.12 : 1;
            const noteRadiusX = lineSpacing * 0.42 * noteScale;
            const noteRadiusY = lineSpacing * 0.29 * noteScale;
            const x = -playableWidth / 2 + beatWidth * (note.startBeat + note.beats * 0.5);
            const y = halfHeight - note.staffStep * lineSpacing * 0.5;
            const alpha = isActive ? 0.78 + pulse * 0.16 : 0.28 + (index % 3) * 0.03;
            const stemDown = note.staffStep >= 6;
            const stemX = x + (stemDown ? -noteRadiusX : noteRadiusX);
            const stemEndY = y + (stemDown ? lineSpacing * 3.1 : -lineSpacing * 3.1);

            noteGraphics.ellipse(x, y, noteRadiusX, noteRadiusY)
                .fill({ color: accentColor, alpha });
            noteGraphics.moveTo(stemX, y);
            noteGraphics.lineTo(stemX, stemEndY);
            noteGraphics.stroke({ color: primaryColor, width: 1.6, alpha: Math.min(0.9, alpha + 0.08) });

            if (note.beats <= 0.5) {
                const flagY = stemEndY;
                const flagDirection = stemDown ? -1 : 1;
                noteGraphics.moveTo(stemX, flagY)
                    .quadraticCurveTo(
                        stemX + lineSpacing * 1.1,
                        flagY + lineSpacing * 0.55 * flagDirection,
                        stemX + lineSpacing * 0.1,
                        flagY + lineSpacing * flagDirection,
                    )
                    .stroke({ color: primaryColor, width: 1.6, alpha: Math.min(0.9, alpha + 0.08) });
            }

            if (note.accidental === 'sharp') {
                const sharpX = x - noteRadiusX * 2.3;
                const sharpHeight = lineSpacing * 1.15;
                noteGraphics.moveTo(sharpX - lineSpacing * 0.16, y - sharpHeight * 0.5)
                    .lineTo(sharpX - lineSpacing * 0.16, y + sharpHeight * 0.5)
                    .moveTo(sharpX + lineSpacing * 0.16, y - sharpHeight * 0.5)
                    .lineTo(sharpX + lineSpacing * 0.16, y + sharpHeight * 0.5)
                    .moveTo(sharpX - lineSpacing * 0.34, y - lineSpacing * 0.12)
                    .lineTo(sharpX + lineSpacing * 0.34, y - lineSpacing * 0.28)
                    .moveTo(sharpX - lineSpacing * 0.34, y + lineSpacing * 0.28)
                    .lineTo(sharpX + lineSpacing * 0.34, y + lineSpacing * 0.12)
                    .stroke({ color: primaryColor, width: 1.2, alpha: Math.min(0.86, alpha + 0.08) });
            }
        });
    };
    
    return {
        display: wrapper,
        halo: null,
        baseX: placement.x,
        baseY: placement.y,
        enterX: placement.enterX,
        enterY: placement.enterY,
        entryRotation: 0,
        finalRotation: placement.rotation,
        startTime: shotStartTime,
        settleTime: shotStartTime + 0.5,
        zDepth: 0,
        isTextGlyph: false,
        updateAnimation,
    };
};
