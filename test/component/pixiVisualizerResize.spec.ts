import { expect, test } from './fixtures';

// test/component/pixiVisualizerResize.spec.ts
// Use the existing real-Pixi probe to catch shared texture-pool regressions across the Pixi modes.
for (const mode of ['sonnet', 'tempera', 'lumiere', 'hanabi']) {
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
        const loadPixiUrl = '/src/components/visualizer/pixi/loadPixi.ts';
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

// 花火的烟花层挂着共享的 bloom：一颗刚升空的火星、几乎出画的烟花，滤镜区域只有一两个像素宽，一级都降不了。
// 那时 bloom 曾取到空的降采样链、抛错中断整帧，后面画的字整层不见。这里在真浏览器里画一个 1x1 的精灵，
// 确认这一帧不抛错、画在它后面的东西照常画出来。
test('bloom on a filter region too small to downsample passes the input through', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/dev-probe.html');
    const result = await page.evaluate(async () => {
        const loadPixiUrl = '/src/components/visualizer/pixi/loadPixi.ts';
        const bloomUrl = '/src/components/visualizer/pixi/bloomFilter.ts';
        const { loadPixi } = await import(/* @vite-ignore */ loadPixiUrl);
        const { createBloomFilter } = await import(/* @vite-ignore */ bloomUrl);
        const pixi: typeof import('pixi.js') = await loadPixi();
        const app = new pixi.Application();
        await app.init({ width: 200, height: 200, resolution: 1, preference: 'webgl', autoStart: false, sharedTicker: false, backgroundAlpha: 0 });
        const spark = new pixi.Container();
        const dot = new pixi.Sprite(pixi.Texture.WHITE);
        dot.width = 1;
        dot.height = 1;
        spark.addChild(dot);
        spark.filters = [createBloomFilter(pixi, { strength: 1, threshold: 0.2, knee: 0.25, levels: 5, spread: 0.85, tint: [1, 1, 1], padding: 0 })];
        // 画在 bloom 之后的东西（像场景里的字）。
        const after = new pixi.Graphics().rect(100, 100, 50, 50).fill(0xff0000);
        app.stage.addChild(spark, after);
        let error: string | null = null;
        let pixel: number[] = [];
        try {
            app.render();
            const extracted = app.renderer.extract.pixels(app.stage);
            const index = (120 * extracted.width + 120) * 4;
            pixel = Array.from(extracted.pixels.slice(index, index + 4));
        } catch (caught) {
            error = String(caught);
        } finally {
            app.destroy(true, { children: true });
        }
        return { error, pixel };
    });
    expect(result.error).toBeNull();
    expect(result.pixel).toEqual([255, 0, 0, 255]);
    expect(errors).toEqual([]);
});
