import { WINDOW } from './song.mjs';

// dev/perf/scenarios.mjs
// The scenarios of the perf rig, as data. Adding one is one entry in SCENARIOS.
//
// A scenario is one lyric style over one background, with the options to change from the app's
// defaults (`tunings`: by the settings store's field name, a patch for the store's own action).
// `set` is 'core' (every style over the default background; every background under one light
// style) or 'second' (the options that change what is drawn, and a song change).
// `songChange` makes the song change one second into each measured window.
//
// Left out on purpose: the 'url' background (it embeds any web page, so there is nothing fixed to
// measure), and the option values that are the app's defaults anyway, which the core rows already
// measure: diorama's clouds with particles on, lumiere at full quality, sonnet with post-processing
// off, tempera with it on, nomand's dithering, latent showing both layers, monet's full overlay.

/** The background each style is measured over: the app's default. */
const DEFAULT_BACKGROUND = 'latent';

/**
 * The style the backgrounds are measured under: the cheapest one that draws a background (still
 * draws none). Chosen from a trial run on a busy PC, where tilt had the least script and
 * style-and-layout time of the DOM styles (about 1.0 ms a frame against 1.9 for classic, 1.2 for
 * cappella, 2.1 for partita, 3.8 for claddagh); to be looked at again on the first quiet baseline.
 */
const BACKGROUND_HOST_STYLE = 'tilt';

/** [id, the name the app shows, how it draws] */
const STYLES = [
    ['classic', 'Luminous', 'DOM'],
    ['sonnet', '商籁', 'Pixi'],
    ['tempera', 'Tempera', 'Pixi'],
    ['lumiere', '绘光', 'Pixi'],
    ['hanabi', '花火', 'Pixi'],
    ['cadenza', 'Mindscape', 'DOM + 2D 画布'],
    ['partita', '云阶', 'DOM'],
    ['fume', 'Fume', 'DOM + 2D 画布'],
    ['tilt', 'Tilt', 'DOM'],
    ['claddagh', 'Claddagh', 'DOM'],
    ['monet', 'Monet', 'DOM + 2D 画布'],
    ['pendolo', 'Pendolo', 'DOM + 2D 画布'],
    ['cappella', 'Cappella', 'DOM'],
    ['diorama', '镜台', 'three.js'],
    ['still', 'Still', 'DOM，不画背景'],
    ['motes', '尘语', '2D 画布'],
];

const style = ([id, name, drawsWith]) => ({
    id: `style-${id}`,
    set: 'core',
    label: `样式 ${name}（${id}，${drawsWith}）`,
    style: id,
    background: DEFAULT_BACKGROUND,
});

const background = (id, label, tunings, suffix = '') => ({
    id: `bg-${id}${suffix ? `-${suffix}` : ''}`,
    set: suffix ? 'second' : 'core',
    label: `背景 ${label}（在 ${BACKGROUND_HOST_STYLE} 样式下）`,
    style: BACKGROUND_HOST_STYLE,
    background: id,
    ...(tunings ? { tunings } : {}),
});

const option = (id, label, styleId, tunings) => ({
    id,
    set: 'second',
    label,
    style: styleId,
    background: DEFAULT_BACKGROUND,
    tunings,
});

const songChange = (styleId, name) => ({
    id: `songchange-${styleId}`,
    set: 'second',
    label: `换歌 ${name}（${styleId}）`,
    style: styleId,
    background: DEFAULT_BACKGROUND,
    songChange: true,
});

export const SCENARIOS = [
    ...STYLES.map(style),
    background('common', 'Common'),
    background('monet', 'Monet'),
    background('nomand', 'Nomand，抖动'),
    background('sora', 'Sora'),

    option('diorama-corridor', '镜台 粒子走廊（diorama，corridor，粒子开）', 'diorama', {
        dioramaTuning: {
            geometryVisibility: { enabled: true, mode: 'corridor', strands: true, blobs: true, ribbons: true, rings: true },
            showParticles: true,
        },
    }),
    option('lumiere-balanced', '绘光 画质 balanced', 'lumiere', { lumiereTuning: { renderQuality: 'balanced' } }),
    option('lumiere-low', '绘光 画质 low', 'lumiere', { lumiereTuning: { renderQuality: 'low' } }),
    option('sonnet-postprocess-on', '商籁 后处理开', 'sonnet', { sonnetTuning: { postProcessEnabled: true } }),
    option('tempera-postprocess-off', 'Tempera 后处理关', 'tempera', { temperaTuning: { postProcessEnabled: false } }),

    background('nomand', 'Nomand，凹槽玻璃', { nomandBackgroundTuning: { effect: 'fluted-glass' } }, 'fluted-glass'),
    background('nomand', 'Nomand，纸纹', { nomandBackgroundTuning: { effect: 'paper-texture' } }, 'paper-texture'),
    background('nomand', 'Nomand，半调网点', { nomandBackgroundTuning: { effect: 'halftone-dots' } }, 'halftone-dots'),
    background('nomand', 'Nomand，镜头畸变', { nomandBackgroundTuning: { effect: 'lens-distortion' } }, 'lens-distortion'),
    background('latent', 'Latent，只有抖动层', { latentBackgroundTuning: { displayMode: 'dithering' } }, 'dithering'),
    background('latent', 'Latent，只有网格渐变层', { latentBackgroundTuning: { displayMode: 'mesh' } }, 'mesh'),
    background('monet', 'Monet，半幅渐变', { monetBackgroundTuning: { backgroundLayout: 'half-pane-gradient' } }, 'half-pane'),

    songChange('diorama', '镜台'),
    songChange('lumiere', '绘光'),
    songChange('sonnet', '商籁'),
    songChange('tempera', 'Tempera'),
];

/** The two scenarios the noise check repeats: a light one and a heavy one. */
export const NOISE_SCENARIOS = ['style-still', 'style-diorama'];

/** The scenario the truth check adds a known cost to. */
export const TRUTH_SCENARIO = 'style-still';

/** The scenario whose page runs the single-thread benchmark that compares the profiles. */
export const BENCHMARK_SCENARIO = 'style-still';

/** The viewport of the measurements, and the larger one the ten heaviest GPU scenarios are repeated at. */
export const VIEWPORT = { width: 1920, height: 1080, deviceScale: 1 };
export const LARGE_VIEWPORT = { width: 2560, height: 1440, deviceScale: 1.5 };

/** How a scenario is played: three windows per load, and how much of the song runs before each. */
export const PLAY = {
    windowsPerLoad: 3,
    /** Seconds of song before the first window of a load: the style's first frames, shader compiles and warm-up stay out of the numbers. */
    firstWarmSeconds: 6,
    /** Seconds before every later window, so a window never begins on the jump back in the song. */
    preRollSeconds: 2,
    /** Before a window with a song change the earlier change has to have finished: a longer run-in. */
    songChangePreRollSeconds: 6,
    songChangeAfterSeconds: 1,
    /** At most this many more windows are played to replace ones spoilt by outside load. */
    extraWindows: 4,
};

/**
 * When a window counts as disturbed by programs that are not the measuring app, each an average
 * over the window:
 *   - they used more than 30% of all processors (a type check or a test run elsewhere takes nearly
 *     all of them; with nothing else running a window reads 3% to 9% on this PC, the rig's own
 *     sampler and runner among it);
 *   - they used more than 25% of the processors the app is held to (0.3% to 4% with nothing else running);
 *   - their 3D engines were busy more than 10% of the time (a game was seen at 85%; the desktop
 *     with nothing moving reads about 1% while the screen is on).
 */
export const OUTSIDE_LOAD = { ofAllProcessors: 0.30, ofHeldProcessors: 0.25, gpuPercent: 10 };

/**
 * The counter sampler's lines of its first seconds are not used: its own start-up is in them (on
 * this PC an idle machine read 11% to 13% of all processors busy there, against 4.5% afterwards).
 */
export const SAMPLER_SETTLE_SECONDS = 5;

/**
 * A window that draws nothing makes a frame for every refresh of the screen, as long as the screen
 * is on. Once the screen has gone off the window is paced by a timer instead: on this PC 128
 * frames a second (a gap of 7.8 ms, half a system tick) where the screen refreshes 160 times. Work
 * that goes by time is then divided by another number of frames, so no per-frame number compares
 * with one taken while the screen was on. The runner turns the screen on for a run; an empty
 * window that is still under this share of the screen's refresh rate marks the result
 * (`disturbedBy: 'frame rate'`) and keeps a baseline from starting.
 */
export const SCREEN_RATE_SHARE = 0.95;

/** The one command that takes the whole baseline. */
export const BASELINE_COMMAND = 'node dev/perf/run.mjs --baseline';

/**
 * What dev/perf/shots.mjs pictures. A plan is what is done in one load of the page, in order. The
 * song only ever goes forward, and at least 4 s of it have played before each picture (but for the
 * one 1.2 s after a song change, which shows what a style draws between two songs).
 *
 *   ['play', t]     the song clock at t, playing       ['jump', t]      a seek forward to t
 *   ['shot', t]     play on to exactly t, then a picture named "<t>s"
 *   ['runTo', t]    play on to exactly t               ['wait', s]      s seconds pass, whatever the song does
 *   ['pause']       ['changeSong']       ['daylight']  ['picture', name]
 *
 * No picture is nearer than 0.3 s to the start or the end of a lyric line (song.mjs; the app's
 * lyric path adds a line "......" at 0.5 to 5.5 s and at 30.25 to 34.55 s):
 *
 *   4.2      the start of the song: the opening "......" line
 *   30.7     into the pause (the line before ended at 30.0, the "......" line began at 30.25)
 *   35.0     out of it (the first chorus line began at 34.6)
 *   41.5, 44.6, 47.5   inside the measured eight seconds: a line with a translation (40.0 to 42.4),
 *            the long line (42.6 to 46.0), a fast line (47.1 to 47.95)
 *   78.5     the second chorus (77.1 to 79.6)
 *   88.0     the last line (86.2 to 89.2)
 *   paused            one second after pausing there
 *   paused-daylight   two seconds after the daylight theme is switched on, still paused
 *
 * The song change is made where the measured one is, one second into the measured window (41.0),
 * and pictured 1.2 s and 5.0 s after it: the new song then stands at 0.95 s (before its first
 * line, 1.4) and at 4.75 s (in its second line, 4.0 to 6.4), because it starts 0.25 s after the
 * change, as in the measured page.
 */
export const SHOT_PLANS = {
    main: [
        ['play', 0], ['shot', 4.2],
        ['jump', 26.4], ['shot', 30.7], ['shot', 35], ['shot', 41.5], ['shot', 44.6], ['shot', 47.5],
        ['jump', 74.4], ['shot', 78.5], ['shot', 88],
        ['pause'], ['wait', 1], ['picture', 'paused'],
        ['daylight'], ['wait', 2], ['picture', 'paused-daylight'],
    ],
    songChange: [
        ['play', 36], ['runTo', 41], ['picture', 'before-change'],
        ['changeSong'], ['wait', 1.2], ['picture', 'change+1.2s'], ['wait', 3.8], ['picture', 'change+5.0s'],
    ],
    large: [['play', 37], ['shot', 41.5], ['shot', 44.6], ['shot', 47.5]],
};

/**
 * The two scenarios with a grain pass (Tempera as it is by default, Sonnet with post-processing),
 * each with its twin without the pass. The grain comes out as one of two fields from capture to
 * capture, so the pictures of these two are held to a floor as high as the grain (shots.mjs,
 * GRAIN_FLOOR) and a small sharp change does not show in them; the twin has a floor of 0.
 * Wherever the grain is pictured its twin is too.
 */
export const SHOT_GRAIN = { 'style-tempera': 'tempera-postprocess-off', 'sonnet-postprocess-on': 'style-sonnet' };

/** The scenarios pictured once more at the large viewport: the ones whose drawing depends most on the size and the pixel ratio, and the twins of the two with grain. */
const SHOT_LARGE = ['style-fume', 'style-claddagh', 'style-lumiere', 'style-pendolo', 'style-cappella', ...Object.keys(SHOT_GRAIN), ...Object.values(SHOT_GRAIN)];

/**
 * Everything shots.mjs captures, each with the name its pictures carry: every scenario that is not
 * a song change by the main plan, a song change for every style (over the default background;
 * Tempera's has grain, so its twin has one too), and the large ones.
 */
export const shotUnits = () => {
    const plain = SCENARIOS.filter(scenario => !scenario.songChange);
    const named = id => plain.find(scenario => scenario.id === id);
    return [
        ...plain.map(scenario => ({ name: scenario.id, scenario, plan: 'main', viewport: VIEWPORT })),
        ...[...STYLES.map(([id]) => `style-${id}`), SHOT_GRAIN['style-tempera']].map(id => ({ name: `songchange-${id.replace(/^style-/, '')}`, scenario: named(id), plan: 'songChange', viewport: VIEWPORT })),
        ...SHOT_LARGE.map(id => ({ name: `large-${id}`, scenario: named(id), plan: 'large', viewport: LARGE_VIEWPORT })),
    ];
};

export const findScenarios = ({ only, set }) => {
    const wanted = only ? new Set(only.split(',')) : null;
    const found = SCENARIOS.filter(scenario => (wanted ? wanted.has(scenario.id) : (!set || set === 'all' || scenario.set === set)));
    if (wanted && found.length !== wanted.size) {
        const known = new Set(SCENARIOS.map(scenario => scenario.id));
        throw new Error(`[perf] no scenario named ${[...wanted].filter(id => !known.has(id)).join(', ')}`);
    }
    return found;
};

/**
 * Seconds a scenario takes around its windows: the launch of the engine with the look at its
 * processes, the load of the page, the start of the sampler, the second look at the processes and
 * the close. Measured on this PC (the `tookSeconds` of the first runs with a launch per scenario).
 */
const LAUNCH_SECONDS = 7;
/** Seconds of one profile's check: its launch, the sampler's first seconds, five seconds of an empty page, the benchmark. */
const CHECK_SECONDS = 25;

/** About how long one scenario takes, in seconds: a launch of the engine and one load of the page. */
const secondsFor = (scenario, windows) => {
    const later = scenario.songChange ? PLAY.songChangePreRollSeconds : PLAY.preRollSeconds;
    return LAUNCH_SECONDS + PLAY.firstWarmSeconds + WINDOW.lengthSeconds + (windows - 1) * (later + WINDOW.lengthSeconds) + windows;
};

/**
 * What the baseline runs: every scenario under laptop and old, the core set under host, the ten
 * heaviest on the graphics card again at the large viewport, five noise rounds and the truth
 * check; with about how many minutes that takes when no window has to be repeated.
 */
export const baselinePlan = (windows = PLAY.windowsPerLoad) => {
    const all = findScenarios({ set: 'all' });
    const core = findScenarios({ set: 'core' });
    const total = list => list.reduce((sum, scenario) => sum + secondsFor(scenario, windows), 0);
    const seconds = 2 * total(all) + total(core) + 10 * secondsFor(all[0], windows)
        + 5 * total(findScenarios({ only: NOISE_SCENARIOS.join(',') }))
        + 2 * secondsFor(all[0], windows) + 3 * CHECK_SECONDS + 60;
    return { all, core, minutes: Math.ceil(seconds / 60) };
};
