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
    segments: SonnetSemanticSegment[];
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
    segments,
    shotKind,
    paragraphKind,
    width,
    height,
    baseFontSize,
    fontFamily,
    fontWeight,
}: SonnetTypographyLayoutOptions): SonnetTypographyPlacement[] => {
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

    // 1. Assign styles and measure boxes
    const boxes = segments.map((segment, index) => {
        const isHero = index === heroIndex;
        let fontScale = 1.0;
        let vertical = false;
        let rotation = 0;
        
        switch (shotKind) {
            case 'editorial-column':
                fontScale = isHero ? 4.0 : 1.2;
                vertical = isHero;
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
        const maxWidth = vertical ? height * 0.82 : width * 0.82; // for vertical, bounds are height
        if (measuredWidth > maxWidth) {
            const fitScale = maxWidth / measuredWidth;
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
            heroBox.x = -width * 0.15;
            heroBox.y = 0;
        } else if (shotKind === 'quiet-tableau') {
            heroBox.x = 0;
            heroBox.y = -height * 0.1;
        } else {
            heroBox.x = 0;
            heroBox.y = 0;
        }
        
        // Implement diverse layout strategies based on shotKind
        if (shotKind === 'quiet-tableau') {
            // 1. Strict Vertical Stack (Centered)
            let currentY = heroBox.y - heroBox.measuredHeight / 2 - 10;
            for (let i = heroIndex - 1; i >= 0; i--) {
                const box = boxes[i];
                box.x = heroBox.x;
                box.y = currentY - box.measuredHeight / 2;
                currentY -= box.measuredHeight + 10;
                box.enterX = 0; box.enterY = 20;
            }
            currentY = heroBox.y + heroBox.measuredHeight / 2 + 10;
            for (let i = heroIndex + 1; i < boxes.length; i++) {
                const box = boxes[i];
                box.x = heroBox.x;
                box.y = currentY + box.measuredHeight / 2;
                currentY += box.measuredHeight + 10;
                box.enterX = 0; box.enterY = -20;
            }
        } else if (shotKind === 'tracking-ribbon') {
            // 2. Pure Horizontal Ribbon (Reading order line)
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
        } else if (shotKind === 'editorial-column') {
            // 3. Editorial Column: Left-aligned blocks next to vertical hero
            // Hero is usually vertical and placed at x = -width * 0.15
            let currentYLeft = heroBox.y - heroBox.measuredHeight / 2 + 20;
            let currentYRight = heroBox.y - heroBox.measuredHeight / 2 + 20;
            
            for (let i = heroIndex - 1; i >= 0; i--) {
                const box = boxes[i];
                box.x = heroBox.x - heroBox.measuredWidth / 2 - box.measuredWidth / 2 - 20;
                box.y = currentYLeft + box.measuredHeight / 2;
                currentYLeft += box.measuredHeight + 15;
                box.enterX = 20; box.enterY = 0;
            }
            for (let i = heroIndex + 1; i < boxes.length; i++) {
                const box = boxes[i];
                box.x = heroBox.x + heroBox.measuredWidth / 2 + box.measuredWidth / 2 + 20;
                box.y = currentYRight + box.measuredHeight / 2;
                currentYRight += box.measuredHeight + 15;
                box.enterX = -20; box.enterY = 0;
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
                box.rotation = (Math.random() - 0.5) * 0.6;
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
            decorations.push({
                ...heroBox,
                isHero: false,
                role: 'decoration' as any,
                fontScale: Math.max(2.8, Math.min(heroBox.fontScale * 3.5, 5.5)),
                vertical: false,
                x: heroBox.x - width * 0.1,
                y: heroBox.y - height * 0.05,
                rotation: -0.15,
                enterX: -width * 0.05,
                enterY: -height * 0.05,
            });
            if (boxes.length > 1) {
                const dec2 = boxes[boxes.length - 1].isHero ? boxes[0] : boxes[boxes.length - 1];
                decorations.push({
                    ...dec2,
                    isHero: false,
                    role: 'decoration' as any,
                    fontScale: Math.max(1.8, Math.min(heroBox.fontScale * 2.2, 3.5)),
                    vertical: false,
                    x: heroBox.x + width * 0.25,
                    y: heroBox.y + height * 0.15,
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
