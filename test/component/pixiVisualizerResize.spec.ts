import { expect, test } from './fixtures';

// test/component/pixiVisualizerResize.spec.ts
// Use the existing real-Pixi probe to catch shared texture-pool regressions across all three modes.
for (const mode of ['sonnet', 'tempera', 'lumiere']) {
    for (const paused of [false, true]) {
        test(`${mode} resizes without destroyed shader bindings (${paused ? 'paused' : 'playing'})`, async ({ page }) => {
            const bindingWarnings: string[] = [];
            const errors: string[] = [];
            page.on('console', message => {
                if (message.text().includes('destroyed while still bound')) bindingWarnings.push(message.text());
            });
            page.on('pageerror', error => errors.push(error.message));
            await page.setViewportSize({ width: 600, height: 400 });
            await page.goto(`/dev-probe.html?probe=visualizerMemory&vis=${mode}&lines=24&speed=1&start=37.5&postprocess=1&freeze=${paused ? 1 : 0}`);
            const canvas = page.locator(`[data-probe-mode="${mode}"] canvas`).first();
            await expect(canvas).toBeVisible();
            // Let initial scene construction finish before the first resize prunes its pass textures.
            await page.waitForTimeout(600);

            for (const viewport of [
                { width: 620, height: 420 },
                { width: 781, height: 650 },
                { width: 600, height: 400 },
            ]) {
                await page.setViewportSize(viewport);
                await expect.poll(() => canvas.evaluate(node => [node.clientWidth, node.clientHeight]))
                    .toEqual([viewport.width, viewport.height]);
                // Lumiere debounces its scene rebuild by 220 ms; cover that frame as well.
                await page.waitForTimeout(400);
            }

            // Unmounting also removes the renderer's registered screen from the shared pool.
            await page.evaluate(() => window.unmount());
            expect(bindingWarnings).toEqual([]);
            expect(errors).toEqual([]);
        });
    }
}

// The visualizer cases above hit this only when a resize lands right after a frame whose nested
// pass was screen-sized (tempera: scene post-process around the lyric inversion). This pins the
// same Pixi path deterministically, through loadPixi so the shim reaches the renderer's FilterSystem.
test('nested Pixi filters render after a resize prunes their pass textures', async ({ page }) => {
    await page.goto('/dev-probe.html');
    const sizes = await page.evaluate(async () => {
        const loadPixiUrl = '/src/components/visualizer/loadPixi.ts';
        const { loadPixi } = await import(/* @vite-ignore */ loadPixiUrl);
        const pixi: typeof import('pixi.js') = await loadPixi();
        const app = new pixi.Application();
        await app.init({ width: 301, height: 201, preference: 'webgl', autoStart: false, sharedTicker: false });
        const outer = new pixi.Container();
        const inner = new pixi.Container();
        outer.filters = [new pixi.AlphaFilter()];
        inner.filters = [new pixi.AlphaFilter()];
        inner.addChild(new pixi.Graphics().rect(0, 0, 400, 300).fill(0xff0000));
        outer.addChild(inner);
        app.stage.addChild(outer);
        try {
            app.render();
            // Prunes the idle 301x201 pass textures the inner stack entry still points at.
            app.renderer.resize(347, 229);
            app.render();
            return [app.renderer.width, app.renderer.height];
        } finally {
            app.destroy(true, { children: true });
        }
    });
    expect(sizes).toEqual([347, 229]);
});
