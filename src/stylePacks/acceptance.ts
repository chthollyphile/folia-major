import { createPackRenderer } from './render';
import { fixtureFrame, type FixtureName } from './fixtures';
import { validateStylePack } from './validate';
import type { StylePack } from './types';

// The report separates machine-checked rendering from human visual acceptance.
export function runPackAcceptance(pack: StylePack, canvas: HTMLCanvasElement) {
    const issues = validateStylePack(pack);
    const checks: { viewport: string; fixture: string; time: number; daylight: boolean; reducedMotion: boolean; milliseconds: number; pass: boolean; error?: string }[] = [];
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable');
    const draw = createPackRenderer();
    if (!issues.length) {
        for (const [width, height] of [[1280, 720], [390, 844], [320, 568]]) {
            canvas.width = width; canvas.height = height;
            for (const fixture of ['demo', 'empty', 'long', 'multilingual'] as FixtureName[]) {
                for (const time of [0, 5.99, 6, 18, 2]) {
                    const daylight = time === 6, reducedMotion = time === 2;
                    const start = performance.now();
                    try {
                        draw(context, pack, fixtureFrame(time, fixture, daylight, reducedMotion), width, height);
                        context.getImageData(0, 0, 1, 1);
                        checks.push({ viewport: `${width}×${height}`, fixture, time, daylight, reducedMotion, milliseconds: performance.now() - start, pass: true });
                    } catch (error) {
                        checks.push({ viewport: `${width}×${height}`, fixture, time, daylight, reducedMotion, milliseconds: performance.now() - start, pass: false, error: String(error) });
                    }
                }
            }
        }
    }
    const sorted = checks.map(check => check.milliseconds).sort((a, b) => a - b);
    return {
        reportVersion: 1, pack: { id: pack.id, version: pack.version }, generatedAt: new Date().toISOString(),
        environment: navigator.userAgent, schema: { pass: !issues.length, issues }, checks,
        renderSmokePass: !issues.length && checks.length === 60 && checks.every(check => check.pass),
        renderCpuP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null,
        manualRequired: ['text readability and contrast', 'no clipping at chosen font scale', 'playback controls remain usable', 'pause/seek appearance', '60-second real-device frame pacing'],
        accepted: false,
    };
}
