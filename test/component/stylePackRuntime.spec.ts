import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';

// These failures depend on the real opaque-origin iframe, Worker, CSP, canvas and video decoder.
test.beforeEach(async ({ page }) => {
    await page.goto('/style-studio.html');
    await expect(page.locator('#metrics')).toContainText('1 frames');
});

test('isolates code, terminates a stuck render and recovers by replacing the package', async ({ page }) => {
    await page.locator('#code').fill('FoliaStyle.define(() => ({render(){ throw new Error("scope:" + typeof document + ":" + typeof localStorage); }}));');
    await expect(page.locator('#status')).toContainText('scope:undefined:undefined');
    await page.locator('#code').fill('FoliaStyle.define(() => ({render(){while(true){}}}));');
    await expect(page.locator('#status')).toContainText('deadline exceeded', { timeout: 7000 });
    await page.locator('#code').fill('FoliaStyle.define(() => ({render(){self.postMessage({type:"progress"}); self.postMessage({type:"frame", id:1}); while(true){}}}));');
    await expect(page.locator('#status')).toContainText('deadline exceeded', { timeout: 7000 });
    await expect(page.locator('#export')).toBeDisabled();
    await page.locator('#example').click();
    await expect(page.locator('#metrics')).toContainText('1 frames');
    await expect(page.locator('#export')).toBeEnabled();
});

test('preserves code and manifest edits made inside the same debounce window', async ({ page }) => {
    const marker = '\n// keep-this-unsaved-code';
    await page.evaluate(marker => {
        const code = document.querySelector<HTMLTextAreaElement>('#code')!, source = document.querySelector<HTMLTextAreaElement>('#source')!;
        code.value += marker; code.dispatchEvent(new Event('input'));
        const manifest = JSON.parse(source.value); manifest.name = 'Edited name';
        source.value = JSON.stringify(manifest); source.dispatchEvent(new Event('input'));
    }, marker);
    await expect(page.locator('#export')).toBeEnabled();
    await expect(page.locator('#code')).toHaveValue(new RegExp('keep-this-unsaved-code'));
    const saved = JSON.parse(await page.locator('#source').inputValue());
    expect(saved.name).toBe('Edited name'); expect(saved.renderer.code).toContain(marker);
});

test('blocks remote requests from a renderer', async ({ page }) => {
    await page.locator('#code').fill('FoliaStyle.define(async () => { let message="NETWORK_ALLOWED"; try { await fetch("https://example.invalid/style-pack-probe"); } catch { message="NETWORK_BLOCKED"; } return {render(){throw new Error(message)}}; });');
    await expect(page.locator('#status')).toContainText('NETWORK_BLOCKED');
});

test('retires previous workers across twenty preview replacements and navigation', async ({ page }) => {
    for (let index = 0; index < 20; index++) {
        const worker = page.waitForEvent('worker');
        await page.locator('#example').click(); await worker;
        await expect.poll(() => page.workers().length).toBe(1);
    }
    await page.goto('about:blank');
    await expect.poll(() => page.workers().length).toBe(0);
});

test('loads a host-provided font into the isolated worker before rendering', async ({ page }) => {
    test.skip(!process.env.FOLIA_TEST_FONT, 'Set FOLIA_TEST_FONT to a local font file');
    const bytes = Array.from(await readFile(process.env.FOLIA_TEST_FONT!));
    const frames = await page.evaluate(async bytes => {
        const runtimePath = '/src/stylePacks/code/host.ts', examplePath = '/src/stylePacks/code/example.ts', fixturePath = '/src/stylePacks/fixtures.ts';
        const { mountCodePack } = await import(runtimePath) as typeof import('../../src/stylePacks/code/host');
        const { RENDERER_PACK } = await import(examplePath) as typeof import('../../src/stylePacks/code/example');
        const { fixtureFrame, fixtureScene } = await import(fixturePath) as typeof import('../../src/stylePacks/fixtures');
        const root = document.createElement('div'); root.style.cssText = 'width:200px;height:100px'; document.body.append(root);
        const { cover, ...frame } = fixtureFrame(0);
        const host = mountCodePack(root, { ...RENDERER_PACK, renderer: { apiVersion: 2, code: 'FoliaStyle.define(() => ({render(){if(![...self.fonts].some(font=>font.family===\"BridgeFont\" && font.status===\"loaded\"))throw new Error(\"missing worker font\");}}));' } },
            () => ({ frame: { ...frame, index: 0, paused: true }, scene: fixtureScene(), animate: false }), error => { throw error; }, true);
        try { await host.setFonts([{ family: 'BridgeFont', data: new Uint8Array(bytes).buffer }]); await host.renderOnce(); return host.metrics().frames; }
        finally { host.dispose(); root.remove(); }
    }, bytes);
    expect(frames).toBe(1);
});

test('composites transparent templates over the preview theme while preserving transparent exports', async ({ page }) => {
    await page.locator('#template-example').click();
    await page.locator('#seek').fill('10');
    const viewport = page.locator('#viewport');
    const pixel = async (bytes: Buffer) => page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return Array.from(ctx.getImageData(5, 5, 1, 1).data);
    }, [...bytes]);
    await expect(viewport).toHaveCSS('background-color', 'rgb(20, 30, 27)');
    expect(await pixel(await viewport.screenshot())).toEqual([20, 30, 27, 255]);
    await page.locator('#daylight').click();
    await expect(viewport).toHaveCSS('background-color', 'rgb(244, 241, 233)');
    expect(await pixel(await viewport.screenshot())).toEqual([244, 241, 233, 255]);
    const png = page.waitForEvent('download'); await page.locator('#snapshot').click();
    expect((await pixel(await readFile((await (await png).path())!)))[3]).toBe(0);
});

test('renders all acceptance scenarios and repeats the same seek frame', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.locator('#report').click();
    const artifact = await download;
    const report = JSON.parse(await readFile((await artifact.path())!, 'utf8'));
    expect(report.checks).toHaveLength(60);
    expect(report.renderSmokePass).toBe(true);
    expect(report.deterministicReplay).toBe(true);
    expect(report.accepted).toBe(false);
    const png = page.waitForEvent('download');
    await page.locator('#snapshot').click();
    expect((await readFile((await (await png).path())!)).subarray(1, 4).toString()).toBe('PNG');
});

test('extracts a local video into timestamped frames and an agent reference ZIP', async ({ page }) => {
    test.skip(!process.env.FOLIA_REFERENCE_TEST_VIDEO, 'Set FOLIA_REFERENCE_TEST_VIDEO to a local decodable test clip');
    await page.locator('.reference summary').click();
    await page.locator('#video-reference input[type=file]').setInputFiles(process.env.FOLIA_REFERENCE_TEST_VIDEO!);
    await expect(page.locator('#video-reference .sample')).toBeEnabled();
    await page.locator('.clip-start').fill('0'); await page.locator('.clip-end').fill('1.2');
    await page.locator('.note').fill('Observe the moving shape'); await page.locator('.mark').click();
    await page.locator('#video-reference .sample').click();
    await expect(page.locator('.reference-frames img')).toHaveCount(8);
    const firstFrameHasPixels = await page.locator('.reference-frames img').first().evaluate(async node => {
        const image = node as HTMLImageElement; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, 16, 16);
        return ctx.getImageData(0, 0, 16, 16).data.some((value, index) => index % 4 !== 3 && value > 40);
    });
    expect(firstFrameHasPixels).toBe(true);
    const download = page.waitForEvent('download'); await page.locator('#video-reference .export').click();
    const zip = unzipSync(await readFile((await (await download).path())!));
    const metadata = JSON.parse(strFromU8(zip['reference.json']));
    expect(metadata.frames[0].time).toBe(0); expect(metadata.frames.at(-1).time).toBe(1.2);
    expect(metadata.marks[0].note).toBe('Observe the moving shape');
    expect(Object.keys(zip).filter(key => key.startsWith('frames/'))).toHaveLength(8);
    expect(zip['frames/01.jpg'][0]).toBe(255); expect(zip['agent-brief.md']).toBeTruthy();
    for (const relative of ['SKILL.md', 'references/builtins.md', 'references/reconstruction.md', 'references/motion-and-acceptance.md', 'references/lyric-release.md', 'references/taxonomy.md']) {
        const original = await readFile(`skills/folia-style-art-direction/${relative}`, 'utf8');
        expect(strFromU8(zip[`skills/folia-style-art-direction/${relative}`])).toBe(original);
    }
});

test('keeps the latest import or explicit replacement when a previous file finishes late', async ({ page }) => {
    const sample = JSON.parse(await page.locator('#source').inputValue());
    await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = async function () {
            const text = await original.call(this);
            if (this.name !== 'slow.json') return text;
            return new Promise<string>(resolve => { (window as any).finishSlowImport = () => resolve(text); });
        };
    });
    const loadSlow = async () => {
        await page.locator('#import').setInputFiles({ name: 'slow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...sample, id: 'test.slow' })) });
        await page.waitForFunction(() => typeof (window as any).finishSlowImport === 'function');
    };
    await loadSlow();
    await page.locator('#import').setInputFiles({ name: 'fast.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...sample, id: 'test.fast', kind: 'lyric-template' })) });
    await expect(page.locator('#source')).toHaveValue(/test.fast/);
    await page.evaluate(async () => { (window as any).finishSlowImport(); delete (window as any).finishSlowImport; await new Promise(resolve => setTimeout(resolve, 0)); });
    await expect(page.locator('#source')).toHaveValue(/test.fast/);
    await loadSlow();
    await page.locator('#template-example').click();
    await page.evaluate(async () => { (window as any).finishSlowImport(); await new Promise(resolve => setTimeout(resolve, 0)); });
    await expect(page.locator('#source')).toHaveValue(/folia.lyric-template/);
});

test('changes category without dropping an uncommitted code edit', async ({ page }) => {
    const original = await page.locator('#code').inputValue();
    await page.locator('#code').fill(original + '\n// preserve-category-edit');
    await page.locator('#kind-lyric-template').click();
    await expect(page.locator('#export')).toBeEnabled();
    const saved = JSON.parse(await page.locator('#source').inputValue());
    expect(saved.kind).toBe('lyric-template'); expect(saved.renderer.code).toContain('preserve-category-edit');
    await expect(page.locator('#kind-lyric-template')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {
        const source = document.querySelector<HTMLTextAreaElement>('#source')!;
        const manifest = JSON.parse(source.value);
        manifest.renderer.code += '\n// preserve-manifest-code';
        source.value = JSON.stringify(manifest); source.dispatchEvent(new Event('input'));
    });
    await page.locator('#kind-personality').click();
    await expect(page.locator('#code')).toHaveValue(/preserve-manifest-code/);
});

test('does not publish an old acceptance report as evidence for a replacement pack', async ({ page }) => {
    const downloads: string[] = [];
    page.on('download', download => downloads.push(download.suggestedFilename()));
    await page.locator('#report').click();
    await page.locator('#template-example').click();
    await expect(page.locator('#report')).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('#source')).toHaveValue(/folia.lyric-template/);
    expect(downloads).toEqual([]);
    await expect(page.locator('#status')).not.toContainText('60/60');
});
