import { mountCodePack } from './host';
import { fixtureFrame, fixtureScene, type FixtureName } from '../fixtures';
import type { CodeStylePack } from './contract';

// Exercises real compiled code and WebGL/2D in the same worker used by production, including seek replay.
export async function runCodeAcceptance(pack: CodeStylePack) {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px';
    document.body.append(container);
    const scene = fixtureScene();
    const { cover: _cover, ...frame } = fixtureFrame(0);
    const host = mountCodePack(container, pack, () => ({ scene, frame: { ...frame, index: 0, paused: true }, animate: false }), () => {}, true);
    const checks: { viewport: string; fixture: string; time: number; pass: boolean; error?: string }[] = [];
    let deterministicReplay = false;
    try {
        await host.ready;
        for (const [width, height] of [[1280, 720], [390, 844], [320, 568]]) {
            for (const fixture of ['demo', 'empty', 'long', 'multilingual'] as FixtureName[]) {
                const scene = fixtureScene(fixture);
                for (const time of [0, 5.99, 6, 18, 2]) {
                    const { cover: _cover, ...frame } = fixtureFrame(time, fixture, time === 6, time === 2);
                    try {
                        await host.renderOnce({ scene, frame: { ...frame, index: fixture === 'empty' ? -1 : Math.floor(time / 6), paused: true }, animate: false }, { width, height, dpr: 1 });
                        checks.push({ viewport: `${width}×${height}`, fixture, time, pass: true });
                    } catch (error) { checks.push({ viewport: `${width}×${height}`, fixture, time, pass: false, error: String(error) }); }
                }
            }
        }
        const sample = async (time: number) => {
            const { cover: _cover, ...frame } = fixtureFrame(time);
            await host.renderOnce({ scene, frame: { ...frame, index: Math.floor(time / 6), paused: true }, animate: false }, { width: 1280, height: 720, dpr: 1 });
            return new Uint8Array(await (await host.capture()).arrayBuffer());
        };
        const a = await sample(2); await sample(18); const b = await sample(2);
        deterministicReplay = a.length === b.length && a.every((byte, i) => byte === b[i]);
        return {
            reportVersion: 2, pack: { id: pack.id, version: pack.version }, generatedAt: new Date().toISOString(),
            environment: navigator.userAgent, checks, deterministicReplay, renderCpuP95Ms: host.metrics().p95Ms,
            renderSmokePass: checks.length === 60 && checks.every(check => check.pass),
            manualRequired: ['continuous motion and lyric cuts', 'word timing and translation readability', 'portrait composition', '60-second real-device frame pacing', 'video reference similarity if supplied'], accepted: false,
        };
    } finally { host.dispose(); container.remove(); }
}
