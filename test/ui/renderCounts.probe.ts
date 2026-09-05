import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/renderCounts.probe.ts
// Locks in which subtrees a given interaction is allowed to re-render, using the probe in
// src/dev/renderCount.ts.
//
// Run with `npm run test:render`. Deliberately NOT part of `npm run test:ui`: a render count is only
// attributable on a machine that is not otherwise busy. Under the parallel suite the app never goes
// idle - the control window alone shows ~24 App renders - and the numbers stop meaning anything.
// A test that is only sometimes measuring is worse than one you have to run on purpose.
//
// Why this exists: App re-renders on any store write anywhere in the app, so every view model it
// assembles must hold its memo for the tree below to be skipped. One callback that changes identity
// every render - anywhere in a chain six hooks deep - silently defeats all of them at once, and
// nothing else in the suite notices. That is exactly the state this repo was in: React.memo on
// Home / PlayerPanel / AppOverlays / AppDialogs bought literally zero skipped renders, measured.
//
// When one of these fails, the question is never "which component regressed" but "which dependency
// stopped being stable". Recover that by dropping a useRef-based comparator next to the failing
// useMemo that records changed dependency names on `window`, then run this file and read them off.
//
// StrictMode is on in dev, so each commit runs a body twice; counts are halved on the way out.


type Counts = Record<string, number>;

const arm = (page: import('@playwright/test').Page) => page.evaluate(() => {
    (window as unknown as { __renderCounts: Counts }).__renderCounts = {};
});

const collect = async (page: import('@playwright/test').Page) => {
    const raw = await page.evaluate(() => ({ ...(window as unknown as { __renderCounts: Counts }).__renderCounts }));
    const counts: Counts = {};
    for (const [name, n] of Object.entries(raw)) {
        counts[name] = n / 2;
    }
    return counts;
};

const show = (label: string, counts: Counts) => {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    console.log(`\n### ${label}\n${rows.map(([n, c]) => `    ${n.padEnd(22)} ${c}`).join('\n') || '    (nothing rendered)'}`);
};

const openApp = async (page: import('@playwright/test').Page, view: 'player' | 'home') => {
    await page.addInitScript(([version, guideKey, startView]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'zh-CN');
        localStorage.setItem('open_player_on_launch', startView === 'player' ? 'true' : 'false');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY, view]);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    // Deliberately no seeded track. A loaded queue drags in audio-source resolution, lyric
    // auto-match and prefetch, all of which resolve on their own schedule and land inside the
    // measurement window as renders that have nothing to do with the write being measured. None of
    // the writes here need a song: they are settings, and the point is which subtree reads them.
    await page.goto('/');
    await page.waitForTimeout(1500);
};

// One write per task, the way a pointer-move stream arrives. Writing them in a single block would
// let React batch all ten into one commit and report a cost no drag ever pays.
const spacedWrites = async (page: import('@playwright/test').Page, modulePath: string, body: string) => {
    await page.evaluate(async ([path, source]) => {
        const module = await import(/* @vite-ignore */ path);
        const step = new Function('store', 'i', source) as (store: unknown, i: number) => void;
        for (let i = 0; i < 10; i += 1) {
            step(module, i);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }, [modulePath, body]);
};

// Best effort: let startup settle before measuring. Not load-bearing - the control window below
// is what actually makes the numbers attributable - so this gives up rather than failing the test.
const waitForQuiet = async (page: import('@playwright/test').Page) => {
    let consecutive = 0;
    for (let attempt = 0; attempt < 20 && consecutive < 2; attempt += 1) {
        await arm(page);
        await page.waitForTimeout(500);
        const busy = await page.evaluate(() => (
            Object.keys((window as unknown as { __renderCounts: Counts }).__renderCounts).length
        ));
        consecutive = busy === 0 ? consecutive + 1 : 0;
    }
};

// Measures the same loop twice: once writing nothing, once writing for real. The app has periodic
// work of its own - playback ticks, cache polling, taskbar sync - and under a loaded machine the
// loop stretches long enough for that to land inside the window. Both windows pay it, so what is
// left after subtraction is what the writes actually caused.
const measureWrites = async (
    page: import('@playwright/test').Page,
    label: string,
    modulePath: string,
    body: string,
): Promise<Counts> => {
    await waitForQuiet(page);
    await arm(page);
    await spacedWrites(page, modulePath, 'void store; void i;');
    await page.waitForTimeout(600);
    const control = await collect(page);

    await arm(page);
    await spacedWrites(page, modulePath, body);
    await page.waitForTimeout(600);
    const treatment = await collect(page);

    const attributed: Counts = {};
    for (const name of new Set([...Object.keys(control), ...Object.keys(treatment)])) {
        attributed[name] = Math.max(0, (treatment[name] ?? 0) - (control[name] ?? 0));
    }
    if (Object.values(control).some(n => n > 0)) {
        show(`${label} — idle control window`, control);
    }
    show(`${label} — attributed to the writes`, attributed);
    return attributed;
};

const TUNING_WRITE = 'store.useVisualizerSettingsStore.getState().handleSetBackgroundOpacity(0.3 + i * 0.01);';
const VOLUME_WRITE = 'store.useAudioSettingsStore.getState().handleSetVolume(0.4 + i * 0.01);';

const measureTuning = (page: import('@playwright/test').Page, label: string) => measureWrites(
    page, label, '/src/stores/useVisualizerSettingsStore.ts', TUNING_WRITE,
);

const measureVolume = (page: import('@playwright/test').Page, label: string) => measureWrites(
    page, label, '/src/stores/useAudioSettingsStore.ts', VOLUME_WRITE,
);

test('a visualizer tuning drag renders nothing below App', async ({ page }) => {
    await openApp(page, 'player');
    const counts = await measureTuning(page, 'player: 10x backgroundOpacity write');

    // App re-renders because it subscribes to the tuning; nothing it assembles depends on it, so
    // every child must be skipped. This is the assertion that catches a newly-unstable callback.
    expect(counts.App).toBeGreaterThan(0);
    for (const name of ['Home', 'PlayerPanel', 'UnifiedPanel', 'AppOverlays', 'AppDialogs']) {
        expect(counts[name] ?? 0, `${name} re-rendered for an unrelated visualizer tuning write`).toBe(0);
    }
});

test('a volume drag renders only the panel that owns the slider', async ({ page }) => {
    await openApp(page, 'player');
    const counts = await measureVolume(page, 'player: 10x volume write');

    expect(counts.PlayerPanel ?? 0, 'the panel owns the volume slider and must re-render').toBeGreaterThan(0);
    for (const name of ['Home', 'AppOverlays', 'AppDialogs']) {
        expect(counts[name] ?? 0, `${name} re-rendered for a volume write it does not read`).toBe(0);
    }
});

test('the home grid is skipped for writes it does not read', async ({ page }) => {
    await openApp(page, 'home');

    // Grid3D and its overlay host are the widest subtree in the app and only exist on this view.
    const tuning = await measureTuning(page, 'home: 10x backgroundOpacity write');
    for (const name of ['Grid3D', 'GridViewOverlayHost', 'Home']) {
        expect(tuning[name] ?? 0, `${name} re-rendered for a visualizer tuning write`).toBe(0);
    }

    const volume = await measureVolume(page, 'home: 10x volume write');
    for (const name of ['Grid3D', 'GridViewOverlayHost', 'Home']) {
        expect(volume[name] ?? 0, `${name} re-rendered for a volume write`).toBe(0);
    }
});

test('a day/night switch reaches every surface', async ({ page }) => {
    await openApp(page, 'player');

    // The counterpart to the tests above: this one MUST cross the memo boundary. A memo that holds
    // here would be a correctness bug, not an optimisation.
    await waitForQuiet(page);
    await arm(page);
    await page.evaluate(async () => {
        const modulePath = '/src/stores/useThemeSettingsStore.ts';
        const { useThemeSettingsStore } = await import(modulePath);
        useThemeSettingsStore.getState().setDaylightPreference(true);
    });

    // Poll instead of waiting a fixed slice: a theme change lands over two commits (the switch, then
    // the regenerated palette), and on a slow machine the second one arrives after any timeout worth
    // writing. Waiting for the names to appear is what this test is actually about.
    const expected = ['Home', 'PlayerPanel', 'AppOverlays', 'AppDialogs'];
    let counts: Counts = {};
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await page.waitForTimeout(300);
        counts = await collect(page);
        if (expected.every(name => (counts[name] ?? 0) > 0)) {
            break;
        }
    }
    show('player: 1x daylight toggle', counts);

    for (const name of expected) {
        expect(counts[name] ?? 0, `${name} did not see the theme change`).toBeGreaterThan(0);
    }
});

// Opens the wall on a seeded queue. The wall is the widest subtree in the app after the grid — one
// poster component per visible slot, ~50 of them — and unlike the grid it is mounted while playback
// is changing, which is when App renders most.
const openWall = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', route => (
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    ));
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
        const playbackPath = '/src/stores/usePlaybackStore.ts';
        const viewsPath = '/src/stores/useAppViewStore.ts';
        const playback = await import(playbackPath);
        const views = await import(viewsPath);
        const queue = Array.from({ length: 40 }, (_, index) => ({
            id: String(index), name: `Song ${index}`, artists: [{ id: 1, name: 'Artist' }],
            album: { id: 1, name: 'Album' }, durationMs: 180_000,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(index) },
        }));
        playback.usePlaybackStore.setState({ playQueue: queue, currentSong: queue[0] });
        views.useAppViewStore.setState({ view: 'lattice' });
    });
    // Long enough for the opening tile-landing wave and the entry pan to finish.
    await page.waitForTimeout(2500);
};

test('a song change does not re-render every poster on the wall', async ({ page }) => {
    await openWall(page);
    const posters = await page.locator('.lattice-poster').count();
    expect(posters, 'the wall did not open on the seeded queue').toBeGreaterThan(20);

    await waitForQuiet(page);
    await arm(page);
    await page.evaluate(async () => {
        const playbackPath = '/src/stores/usePlaybackStore.ts';
        const playback = await import(playbackPath);
        const state = playback.usePlaybackStore.getState();
        state.setCurrentSong(state.playQueue[1]);
    });
    await page.waitForTimeout(1200);
    const counts = await collect(page);
    show(`wall: 1x song change (${posters} posters on screen)`, counts);

    // What this budget is really guarding: a song change writes to stores App subscribes to, and
    // every one of those App renders reaches the wall through props App rebuilds each time. Before
    // the poster memo and the stable handler chain below it, this measured 725 — roughly one full
    // pass over every poster per App render, on the same frames the app is decoding the new track.
    // Two passes' worth is what the change itself costs: the section badges move, the expanded
    // block reflows, and the pan reveals new slots.
    expect(counts.LatticePoster ?? 0, 'the wall re-rendered every poster several times over')
        .toBeLessThan(posters * 3);
    expect(counts.App ?? 0, 'App re-rendered more than the song change itself explains')
        .toBeLessThan(5);
});
