import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import type {
    SonnetParagraphKind,
    SonnetSemanticSegment,
    SonnetShotKind,
} from './types';

// src/components/visualizer/sonnet/sonnetTypographyLayout.ts
// PV-style kinetic typography layouts based on exact box measurements
export type SonnetSegmentRole = 'hero' | 'support' | 'decoration';

export interface SonnetTypographyPlacement {
    segmentIndex: number;
    displayText: string;
    role: SonnetSegmentRole;
    fontScale: number;
    x: number;
    y: number;
    rotation: number;
    enterX: number;
    enterY: number;
    vertical: boolean;
    timingPhase: number;
}

interface SonnetTypographyLayoutOptions {
    lines: SonnetSemanticSegment[][];
    shotKind: SonnetShotKind;
    paragraphKind: SonnetParagraphKind;
    width: number;
    height: number;
    baseFontSize: number;
    fontFamily: string;
    fontWeight: number;
}

const visibleLength = (segment: SonnetSemanticSegment) => (
    segment.graphemes.filter(item => item.char.trim().length > 0).length
);

export const findSonnetHeroSegmentIndex = (
    segments: SonnetSemanticSegment[],
) => {
    let bestIndex = segments.findIndex(segment => segment.isWordLike);
    let bestScore = -Infinity;
    segments.forEach((segment, index) => {
        if (!segment.isWordLike || visibleLength(segment) === 0) return;
        const lengthScore = Math.min(visibleLength(segment), 8) * 14;
        const durationScore = Math.min(2.5, Math.max(0, segment.endTime - segment.startTime)) * 18;
        const score = lengthScore + durationScore;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });
    return Math.max(0, bestIndex);
};

const verticalText = (segment: SonnetSemanticSegment) => (
    (segment.graphemes.length ? segment.graphemes.map(item => item.char) : Array.from(segment.text))
        .join('\n')
);

export const measureText = (text: string, fontSpec: string, fontSize: number) => {
    try {
        const layout = layoutWithLines(prepareWithSegments(text || ' ', fontSpec), 99999, fontSize * 1.2);
        return layout.lines[0]?.width ?? text.length * fontSize * 0.6;
    } catch {
        return text.length * fontSize * 0.6;
    }
};

export const resolveSonnetTypographyLayout = ({
    lines,
    shotKind,
    paragraphKind,
    width,
    height,
    baseFontSize,
    fontFamily,
    fontWeight,
}: SonnetTypographyLayoutOptions): SonnetTypographyPlacement[] => {
    const segments = lines.flat();
    
    let offset = 0;
    const heroIndices = lines.map(lineSegs => {
        const localHero = findSonnetHeroSegmentIndex(lineSegs);
        const globalHero = offset + localHero;
        offset += lineSegs.length;
        return globalHero;
    });

    const heroIndex = findSonnetHeroSegmentIndex(segments);
    const midpoints = segments.map(segment => (segment.startTime + segment.endTime) / 2);
    const timelineStart = Math.min(...midpoints);
    const timelineEnd = Math.max(...midpoints);
    const timelineDuration = timelineEnd - timelineStart;
    const phases = midpoints.map((midpoint, index) => (
        timelineDuration > 0.001
            ? (midpoint - timelineStart) / timelineDuration
            : index / Math.max(1, segments.length - 1)
    ));
    const heroPhase = phases[heroIndex] ?? 0.5;

    // Deterministic pseudo-randomness for layout variations
    const layoutVariantSeed = segments.reduce((acc, seg) => acc + (seg.text.trim().length || 1), 0) + segments.length;
    let editorialVariant = layoutVariantSeed % 4; // Expanded to 4 variants
    const ribbonVariant = layoutVariantSeed % 3;
    const tableauVariant = layoutVariantSeed % 2;

    let secondaryHeroIndex = -1;
    if (editorialVariant === 3 && segments.length > 2) {
        let bestScore = -Infinity;
        segments.forEach((segment, index) => {
            if (index === heroIndex || !segment.isWordLike || visibleLength(segment) === 0) return;
            const lengthScore = Math.min(visibleLength(segment), 8) * 14;
            const durationScore = Math.min(2.5, Math.max(0, segment.endTime - segment.startTime)) * 18;
            const distanceBonus = Math.abs(index - heroIndex) > 1 ? 50 : 0; 
            const score = lengthScore + durationScore + distanceBonus;
            if (score > bestScore) {
                bestScore = score;
                secondaryHeroIndex = index;
            }
        });
        if (secondaryHeroIndex === -1) editorialVariant = 0;
    } else if (editorialVariant === 3) {
        editorialVariant = 0;
    }

    // 1. Assign styles and measure boxes
    const boxes = segments.map((segment, index) => {
        const isHero = heroIndices.includes(index) || (index === secondaryHeroIndex && shotKind === 'editorial-column' && editorialVariant === 3);
        let fontScale = 1.0;
        let vertical = false;
        let rotation = 0;

        switch (shotKind) {
            case 'editorial-column':
                if (editorialVariant === 3) {
                    fontScale = isHero ? 3.8 : 1.3;
                    vertical = false;
                } else {
                    fontScale = isHero ? (editorialVariant === 2 ? 3.2 : 4.0) : 1.2;
                    vertical = isHero && editorialVariant !== 2;
                }
                break;
            case 'type-impact':
                fontScale = isHero ? 5.5 : 1.5;
                break;
            case 'fragment-collage':
                fontScale = isHero ? 3.0 : 1.3;
                vertical = (index % 4) === 0;
                break;
            case 'tracking-ribbon':
                fontScale = isHero ? 3.5 : 1.5;
                break;
            case 'mask-reveal':
                fontScale = isHero ? 4.5 : 1.6;
                vertical = isHero;
                break;
            case 'quiet-tableau':
            default:
                fontScale = isHero ? 3.0 : 1.1;
                break;
        }

        // To prevent massive text from overflowing 82% of screen width, we calculate a fitScale
        let displayText = vertical ? verticalText(segment) : segment.text;
        const renderWeight = isHero ? '900' : '700';

        let targetFontSize = baseFontSize * fontScale;
        let fontSpec = `${renderWeight} ${targetFontSize}px ${fontFamily}`;

        let measuredWidth = vertical
            ? targetFontSize * 1.1
            : measureText(displayText, fontSpec, targetFontSize);

        let measuredHeight = vertical
            ? targetFontSize * 1.1 * (displayText.split('\n').length)
            : targetFontSize * 1.2;

        // Safe downscale if it exceeds screen bounds
        const maxW = width * 0.82;
        const maxH = height * 0.82;
        let fitScale = 1.0;
        if (measuredWidth > maxW) fitScale = Math.min(fitScale, maxW / measuredWidth);
        if (measuredHeight > maxH) fitScale = Math.min(fitScale, maxH / measuredHeight);

        if (fitScale < 1.0) {
            targetFontSize *= fitScale;
            fontScale *= fitScale;
            measuredWidth *= fitScale;
            measuredHeight *= fitScale;
        }

        return {
            index,
            isHero,
            displayText,
            fontScale,
            vertical,
            rotation,
            measuredWidth,
            measuredHeight,
            timingPhase: phases[index],
            relativePhase: phases[index] - heroPhase,
            role: undefined as SonnetSegmentRole | undefined,
            x: 0,
            y: 0,
            enterX: 0,
            enterY: 0
        };
    });

    // 2. Exact Layout Packing
    const heroBox = boxes[heroIndex];
    if (heroBox) {
        if (shotKind === 'editorial-column') {
            if (editorialVariant === 0) heroBox.x = -width * 0.15;
            else if (editorialVariant === 1) heroBox.x = width * 0.15;
            else heroBox.x = 0; // Variant 2 (centered horizontal)

            heroBox.y = (editorialVariant === 2) ? -height * 0.25 : 0;
        } else if (shotKind === 'quiet-tableau') {
            heroBox.x = 0;
            heroBox.y = -height * 0.1;
        } else {
            heroBox.x = 0;
            heroBox.y = 0;
        }

        // Implement diverse layout strategies based on shotKind
        if (shotKind === 'quiet-tableau') {
            if (tableauVariant === 0) {
                // 1a. Strict Vertical Stack (Centered)
                // Use a spacing factor (e.g., 0.6) because measuredHeight (1.2x font size) is too generous for this specific layout
                const spacingFactor = 0.6;
                let currentY = heroBox.y - (heroBox.measuredHeight * spacingFactor) / 2 - 5;
                for (let i = heroIndex - 1; i >= 0; i--) {
                    const box = boxes[i];
                    box.x = heroBox.x;
                    box.y = currentY - (box.measuredHeight * spacingFactor) / 2;
                    currentY -= (box.measuredHeight * spacingFactor) + 5;
                    box.enterX = 0; box.enterY = 20;
                }
                currentY = heroBox.y + (heroBox.measuredHeight * spacingFactor) / 2 + 5;
                for (let i = heroIndex + 1; i < boxes.length; i++) {
                    const box = boxes[i];
                    box.x = heroBox.x;
                    box.y = currentY + (box.measuredHeight * spacingFactor) / 2;
                    currentY += (box.measuredHeight * spacingFactor) + 5;
                    box.enterX = 0; box.enterY = -20;
                }
            } else {
                // 1b. Flush-Left Vertical Stack (Modern Poster)
                let currentY = heroBox.y - heroBox.measuredHeight / 2 - 10;
                for (let i = heroIndex - 1; i >= 0; i--) {
                    const box = boxes[i];
                    box.x = heroBox.x - heroBox.measuredWidth / 2 + box.measuredWidth / 2;
                    box.y = currentY - box.measuredHeight / 2;
                    currentY -= box.measuredHeight + 10;
                    box.enterX = 20; box.enterY = 0;
                }
                currentY = heroBox.y + heroBox.measuredHeight / 2 + 10;
                for (let i = heroIndex + 1; i < boxes.length; i++) {
                    const box = boxes[i];
                    box.x = heroBox.x - heroBox.measuredWidth / 2 + box.measuredWidth / 2;
                    box.y = currentY + box.measuredHeight / 2;
                    currentY += box.measuredHeight + 10;
                    box.enterX = -20; box.enterY = 0;
                }
            }
        } else if (shotKind === 'tracking-ribbon') {
            if (ribbonVariant === 0) {
                // 2a. Pure Horizontal Ribbon (Reading order line)
                let currentX = heroBox.x - heroBox.measuredWidth / 2 - 15;
                for (let i = heroIndex - 1; i >= 0; i--) {
                    const box = boxes[i];
                    box.x = currentX - box.measuredWidth / 2;
                    box.y = heroBox.y + (i % 2 === 0 ? 10 : -10); // Slight undulation
                    currentX -= box.measuredWidth + 15;
                    box.enterX = 30; box.enterY = 0;
                }
                currentX = heroBox.x + heroBox.measuredWidth / 2 + 15;
                for (let i = heroIndex + 1; i < boxes.length; i++) {
                    const box = boxes[i];
                    box.x = currentX + box.measuredWidth / 2;
                    box.y = heroBox.y + (i % 2 === 0 ? 10 : -10);
                    currentX += box.measuredWidth + 15;
                    box.enterX = -30; box.enterY = 0;
                }
            } else if (ribbonVariant === 1) {
                // 2b. Strict Baseline Aligned Ribbon with extra spacing
                let currentX = heroBox.x - heroBox.measuredWidth / 2 - 25;
                for (let i = heroIndex - 1; i >= 0; i--) {
                    const box = boxes[i];
                    box.x = currentX - box.measuredWidth / 2;
                    box.y = heroBox.y + heroBox.measuredHeight / 2 - box.measuredHeight / 2;
                    currentX -= box.measuredWidth + 25;
                    box.enterX = 30; box.enterY = 0;
                }
                currentX = heroBox.x + heroBox.measuredWidth / 2 + 25;
                for (let i = heroIndex + 1; i < boxes.length; i++) {
                    const box = boxes[i];
                    box.x = currentX + box.measuredWidth / 2;
                    box.y = heroBox.y + heroBox.measuredHeight / 2 - box.measuredHeight / 2;
                    currentX += box.measuredWidth + 25;
                    box.enterX = -30; box.enterY = 0;
                }
            } else {
                // 2c. Top Aligned Ribbon with larger spacing
                let currentX = heroBox.x - heroBox.measuredWidth / 2 - 35;
                for (let i = heroIndex - 1; i >= 0; i--) {
                    const box = boxes[i];
                    box.x = currentX - box.measuredWidth / 2;
                    box.y = heroBox.y - heroBox.measuredHeight / 2 + box.measuredHeight / 2;
                    currentX -= box.measuredWidth + 35;
                    box.enterX = 20; box.enterY = 0;
                }
                currentX = heroBox.x + heroBox.measuredWidth / 2 + 35;
                for (let i = heroIndex + 1; i < boxes.length; i++) {
                    const box = boxes[i];
                    box.x = currentX + box.measuredWidth / 2;
                    box.y = heroBox.y - heroBox.measuredHeight / 2 + box.measuredHeight / 2;
                    currentX += box.measuredWidth + 35;
                    box.enterX = -20; box.enterY = 0;
                }
            }
        } else if (shotKind === 'editorial-column') {
            if (editorialVariant === 0) {
                // 3a. Editorial Column: Original (hero left, text on left and right)
                let currentYLeft = heroBox.y - heroBox.measuredHeight / 2 + 20;
                let currentYRight = heroBox.y - heroBox.measuredHeight / 2 + 20;

                for (let i = heroIndex - 1; i >= 0; i--) {
                    const box = boxes[i];
                    box.x = heroBox.x - heroBox.measuredWidth / 2 - box.measuredWidth / 2 - 25;
                    box.y = currentYLeft + box.measuredHeight / 2;
                    currentYLeft += box.measuredHeight + 15;
                    box.enterX = 20; box.enterY = 0;
                }
                for (let i = heroIndex + 1; i < boxes.length; i++) {
                    const box = boxes[i];
                    box.x = heroBox.x + heroBox.measuredWidth / 2 + box.measuredWidth / 2 + 25;
                    box.y = currentYRight + box.measuredHeight / 2;
                    currentYRight += box.measuredHeight + 15;
                    box.enterX = -20; box.enterY = 0;
                }
            } else if (editorialVariant === 1) {
                // 3b. Magazine Layout: Hero Vertical Right, all support text in a neat column on the left
                let currentY = heroBox.y - heroBox.measuredHeight / 2 + 10;
                for (let i = 0; i < boxes.length; i++) {
                    if (i === heroIndex) continue;
                    const box = boxes[i];
                    box.x = heroBox.x - heroBox.measuredWidth / 2 - box.measuredWidth / 2 - 40;
                    box.y = currentY + box.measuredHeight / 2;
                    currentY += box.measuredHeight + 15;
                    box.enterX = -20; box.enterY = 0;
                }
            } else if (editorialVariant === 2) {
                // 3c. Magazine Header: Horizontal hero at top, text blocks below in two columns
                let currentXLeft = heroBox.x - heroBox.measuredWidth * 0.25 - 10;
                let currentXRight = heroBox.x + heroBox.measuredWidth * 0.25 + 10;
                let leftY = heroBox.y + heroBox.measuredHeight / 2 + 40;
                let rightY = heroBox.y + heroBox.measuredHeight / 2 + 40;

                for (let i = 0; i < boxes.length; i++) {
                    if (i === heroIndex) continue;
                    const box = boxes[i];
                    if (i % 2 === 0) {
                        box.x = currentXLeft - box.measuredWidth / 2;
                        box.y = leftY + box.measuredHeight / 2;
                        leftY += box.measuredHeight + 12;
                        box.enterX = -20; box.enterY = 0;
                    } else {
                        box.x = currentXRight + box.measuredWidth / 2;
                        box.y = rightY + box.measuredHeight / 2;
                        rightY += box.measuredHeight + 12;
                        box.enterX = 20; box.enterY = 0;
                    }
                }
            } else if (editorialVariant === 3) {
                // 3d. Double Hero Lines (Two massive focal points on two offset lines)
                const firstHero = Math.min(heroIndex, secondaryHeroIndex);
                
                // Line 1: index 0 to firstHero
                let currentX1 = 0;
                let line1Y = heroBox.y - heroBox.measuredHeight * 0.45 - 15;
                for (let i = 0; i <= firstHero; i++) {
                    const box = boxes[i];
                    box.y = line1Y;
                    box.x = currentX1 + box.measuredWidth / 2;
                    currentX1 += box.measuredWidth + 20;
                    box.enterX = 30; box.enterY = 0;
                }
                const line1Width = currentX1 - 20;
                for (let i = 0; i <= firstHero; i++) {
                    boxes[i].x -= line1Width / 2;
                }

                // Line 2: index firstHero + 1 to end
                let currentX2 = 0;
                let line2Y = heroBox.y + heroBox.measuredHeight * 0.45 + 15;
                for (let i = firstHero + 1; i < boxes.length; i++) {
                    const box = boxes[i];
                    box.y = line2Y;
                    box.x = currentX2 + box.measuredWidth / 2;
                    currentX2 += box.measuredWidth + 20;
                    box.enterX = -30; box.enterY = 0;
                }
                const line2Width = currentX2 > 0 ? currentX2 - 20 : 0;
                for (let i = firstHero + 1; i < boxes.length; i++) {
                    boxes[i].x -= line2Width / 2;
                }
                
                // Offset the two lines to create a dynamic, staggered stairs typography feel
                const offsetAmount = Math.max(line1Width, line2Width) * 0.12;
                for (let i = 0; i <= firstHero; i++) boxes[i].x -= offsetAmount;
                for (let i = firstHero + 1; i < boxes.length; i++) boxes[i].x += offsetAmount;
            }
        } else if (shotKind === 'fragment-collage') {
            // 4. Fragment Collage: Scattered, overlapping, chaotic positioning
            for (let i = 0; i < boxes.length; i++) {
                if (i === heroIndex) continue;
                const box = boxes[i];
                const angle = (i / boxes.length) * Math.PI * 2 + Math.PI / 4 + (Math.random() * 0.5);
                // Base radius on the hero box size to ensure they orbit OUTSIDE the hero word
                const baseRadius = Math.max(heroBox.measuredWidth, heroBox.measuredHeight) / 2;
                const radius = baseRadius + 40 + Math.random() * 120;
                box.x = heroBox.x + Math.cos(angle) * (radius + box.measuredWidth / 2);
                box.y = heroBox.y + Math.sin(angle) * (radius * 0.6 + box.measuredHeight / 2);
                box.rotation = 0;
                box.enterX = Math.cos(angle) * -60;
                box.enterY = Math.sin(angle) * -60;
            }
        } else {
            // 5. Dynamic Cross/Zigzag ('type-impact', 'mask-reveal')
            // To preserve readability and avoid camera tracking jitter, we form continuous lines
            // Reading order flow: Top -> Left -> Hero -> Right -> Bottom
            const beforeCount = heroIndex;
            const topCount = Math.floor(beforeCount / 2);
            const afterCount = boxes.length - 1 - heroIndex;
            const rightCount = Math.ceil(afterCount / 2);

            // Place Left words (heroIndex - 1 down to topCount). Read left-to-right.
            let currentXLeft = heroBox.x - heroBox.measuredWidth / 2 - 25;
            for (let i = heroIndex - 1; i >= topCount; i--) {
                const box = boxes[i];
                box.x = currentXLeft - box.measuredWidth / 2;
                box.y = heroBox.y + (i % 2 === 0 ? 10 : -10);
                currentXLeft -= box.measuredWidth + 25;
                box.enterX = -30; box.enterY = 0;
            }

            // Place Top words (topCount - 1 down to 0). Read top-to-bottom.
            let currentYTop = heroBox.y - heroBox.measuredHeight / 2 - 20;
            for (let i = topCount - 1; i >= 0; i--) {
                const box = boxes[i];
                box.x = heroBox.x + (i % 2 === 0 ? 15 : -15);
                box.y = currentYTop - box.measuredHeight / 2;
                currentYTop -= box.measuredHeight + 15;
                box.enterX = 0; box.enterY = -30;
            }

            // Place Right words (heroIndex + 1 up to heroIndex + rightCount). Read left-to-right.
            let currentXRight = heroBox.x + heroBox.measuredWidth / 2 + 25;
            for (let i = heroIndex + 1; i <= heroIndex + rightCount; i++) {
                const box = boxes[i];
                box.x = currentXRight + box.measuredWidth / 2;
                box.y = heroBox.y + (i % 2 === 0 ? 10 : -10);
                currentXRight += box.measuredWidth + 25;
                box.enterX = 30; box.enterY = 0;
            }

            // Place Bottom words (heroIndex + rightCount + 1 to end). Read top-to-bottom.
            let currentYBottom = heroBox.y + heroBox.measuredHeight / 2 + 20;
            for (let i = heroIndex + rightCount + 1; i < boxes.length; i++) {
                const box = boxes[i];
                box.x = heroBox.x + (i % 2 === 0 ? 15 : -15);
                box.y = currentYBottom + box.measuredHeight / 2;
                currentYBottom += box.measuredHeight + 15;
                box.enterX = 0; box.enterY = 30;
            }
        }

        heroBox.enterX = 0;
        heroBox.enterY = height * 0.15;

        const decorations: typeof boxes = [];
        if (shotKind !== 'quiet-tableau') {
            const allHeroes = boxes.filter(b => b.isHero);
            allHeroes.forEach((hBox, idx) => {
                decorations.push({
                    ...hBox,
                    isHero: false,
                    role: 'decoration' as any,
                    fontScale: Math.max(2.8, Math.min(hBox.fontScale * 3.5, 5.5)),
                    vertical: false,
                    x: hBox.x - width * (0.1 - idx * 0.03),
                    y: hBox.y - height * (0.05 - idx * 0.02),
                    rotation: -0.15 + (idx % 2 === 0 ? 0 : 0.05),
                    enterX: -width * 0.05,
                    enterY: -height * 0.05,
                });
            });
            if (boxes.length > 1 && allHeroes.length > 0) {
                const dec2 = boxes[boxes.length - 1].isHero ? boxes[0] : boxes[boxes.length - 1];
                decorations.push({
                    ...dec2,
                    isHero: false,
                    role: 'decoration' as any,
                    fontScale: Math.max(1.8, Math.min(allHeroes[0].fontScale * 2.2, 3.5)),
                    vertical: false,
                    x: allHeroes[0].x + width * 0.25,
                    y: allHeroes[0].y + height * 0.15,
                    rotation: 0.08,
                    enterX: width * 0.05,
                    enterY: height * 0.05,
                });
            }
        }

        boxes.unshift(...decorations);
    }

    return boxes.map(box => ({
        segmentIndex: box.index,
        displayText: box.displayText,
        role: box.role || (box.isHero ? 'hero' : 'support'),
        fontScale: box.fontScale,
        x: box.x,
        y: box.y,
        rotation: box.rotation,
        enterX: box.enterX,
        enterY: box.enterY,
        vertical: box.vertical,
        timingPhase: box.timingPhase,
    }));
};
