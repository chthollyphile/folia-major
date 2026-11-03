import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/collectionMorph.spec.ts
// 「移形换影」的浏览器级回归：被点的封面飞到打开的那一页，返回时再飞回去。
//
// 为什么要组件测试而不是单测：这段转场的失败方式是位置、层叠和时序 —— 第一帧在不在卡片上、
// 量到的是哪一页的落点、落地时底下那张图露没露出来、生命周期会不会自己结束，都只有真的挂进
// DOM 才看得出来。
//
// 飞行只活几百毫秒，比测试进程的一次往返还短，所以读数由页内的记录器逐帧累积，测试事后读一次。
// 飞的那一层 portal 在 document.body 上，只能在 page 上查；探针自己的界面从 #root 查。
//
// 基线（重写之前的实现，同一台机器、同一张探针页，2026-10-08）：第一帧带 blur(6px) 和旋转；
// 途中宽度比两端都宽 41.6px、高度高 69.6px（先飞向一个猜的位置）；最长一帧 50.9ms；
// 位置和大小由脚本每帧改 left/top/width/height，Web Animations 只管 filter 和 opacity。

// The carrier's picture (what the figures of a flight are read off), and the whole carrier.
const CARRIER = '[data-folia-collection-morph="cover"]';
const CARRIER_ROOT = '[data-folia-collection-morph="carrier"]';
const STAND_IN = '[data-probe-stand-in]';
const STAND_IN_COVER = '[data-probe-stand-in-cover]';
const HOME_CARD = '[data-probe-home-card]';
const HOME_COVER = '[data-probe-home-card] img';
// How long a carrier flies before it lands (it then dissolves over the card it landed on).
const FLIGHT_MS = 460;

type Box = { x: number; y: number; width: number; height: number };
type Line = Box & { text: string; opacity: number; even: boolean };
type Reading = Box & {
    at: number; filter: string; rotated: boolean; pictureShape: number | null;
    /** The opacity of the card the carrier lands on, and of the one it left. */
    coveredOpacity: string | null;
    sourceOpacity: string | null;
    /** The carrier's frame, and its titles (`even`: scaled by one factor both ways). */
    frame: (Box & { opacity: number }) | null;
    /** The frame's edge: where it is, and how strongly it is lit. */
    edge: (Box & { opacity: number }) | null;
    titles: Line[];
};
type Flight = {
    readings: Reading[];
    /** Milliseconds from the start of the recording to the first frame with the carrier, and to the first without. */
    appeared: number | null;
    gone: number | null;
    /** How many carriers were put on the page. */
    carriers: number;
    direction: string | null;
    /** The carrier's box at the first and the last keyframe of its flight, on the screen. */
    firstKeyframe: Box | null;
    lastKeyframe: Box | null;
    /** The corners at the first and the last keyframe, as written. */
    corners: [string, string] | null;
    /** The properties each Web Animation on the carrier animates. */
    animated: string[][];
    /** Those of the animations on the frame's edge alone, and the shadow the edge is drawn as. */
    edgeAnimated: string[][];
    edgeShadow: string | null;
};

/**
 * Starts the recorder; call BEFORE what starts the flight. `covered` is the card the carrier lands
 * on and `source` the one it leaves: their opacity is read every frame the carrier is there.
 */
const record = (page: Page, covered: string | null = null, limitMs = 6000, source: string | null = null) => (
    page.evaluate(([carrierAt, rootAt, coveredAt, limit, sourceAt]) => {
        const boxOf = (element: Element): Box => {
            const rect = element.getBoundingClientRect();
            return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        };
        const flight: Flight = {
            readings: [], appeared: null, gone: null, carriers: 0, direction: null, firstKeyframe: null, lastKeyframe: null, corners: null,
            animated: [], edgeAnimated: [], edgeShadow: null,
        };
        const observer = new MutationObserver((changes) => {
            for (const change of changes) {
                for (const node of change.addedNodes) {
                    if (node instanceof Element && node.matches(rootAt)) flight.carriers += 1;
                }
            }
        });
        observer.observe(document.body, { childList: true });
        const numbersOf = (text: string) => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        (window as unknown as { __morphFlight?: Promise<Flight> }).__morphFlight = new Promise<Flight>((resolve) => {
            const started = performance.now();
            const step = () => {
                const now = performance.now();
                const layer = document.querySelector<HTMLElement>(carrierAt);
                if (layer) {
                    flight.appeared ??= now - started;
                    flight.direction = layer.getAttribute('data-folia-collection-morph-direction');
                    const style = getComputedStyle(layer);
                    const matrix = new DOMMatrix(style.transform);
                    const picture = layer.querySelector('img')?.getBoundingClientRect();
                    const opacityAt = (selector: string | null) => {
                        const element = selector ? document.querySelector(selector) : null;
                        return element ? getComputedStyle(element).opacity : null;
                    };
                    const frame = layer.parentElement!.querySelector('[data-folia-collection-morph="frame"]');
                    const edge = layer.parentElement!.querySelector('[data-folia-collection-morph="edge"]');
                    if (edge) flight.edgeShadow ??= getComputedStyle(edge).boxShadow;
                    flight.readings.push({
                        ...boxOf(layer), at: now - started, filter: style.filter,
                        rotated: Math.abs(matrix.b) > 0.001 || Math.abs(matrix.c) > 0.001,
                        pictureShape: picture && picture.height > 0 ? picture.width / picture.height : null,
                        coveredOpacity: opacityAt(coveredAt),
                        sourceOpacity: opacityAt(sourceAt),
                        frame: frame ? { ...boxOf(frame), opacity: Number(getComputedStyle(frame).opacity) } : null,
                        edge: edge ? { ...boxOf(edge), opacity: Number(getComputedStyle(edge).opacity) } : null,
                        titles: [...layer.parentElement!.querySelectorAll('[data-folia-collection-morph="title"]')].map((line) => {
                            const lineStyle = getComputedStyle(line);
                            const lineMatrix = new DOMMatrix(lineStyle.transform);
                            return { ...boxOf(line), text: line.textContent ?? '', opacity: Number(lineStyle.opacity), even: Math.abs(lineMatrix.a - lineMatrix.d) < 0.0005 };
                        }),
                    });
                    // The picture's animations, and the edge's (it lies over the picture, not in it).
                    for (const animation of [...layer.getAnimations({ subtree: true }), ...(edge?.getAnimations() ?? [])]) {
                        const effect = animation.effect as KeyframeEffect;
                        const frames = effect.getKeyframes();
                        const properties = [...new Set(frames.flatMap(frame => Object.keys(frame)))]
                            .filter(name => !['offset', 'easing', 'composite', 'computedOffset'].includes(name)).sort();
                        if (!flight.animated.some(known => known.join() === properties.join())) flight.animated.push(properties);
                        if (effect.target === edge && !flight.edgeAnimated.some(known => known.join() === properties.join())) flight.edgeAnimated.push(properties);
                        if (effect.target === layer && properties.includes('transform') && !flight.firstKeyframe) {
                            const laidOut = { x: Number.parseFloat(layer.style.left), y: Number.parseFloat(layer.style.top), width: Number.parseFloat(layer.style.width), height: Number.parseFloat(layer.style.height) };
                            const at = (frame: ComputedKeyframe): Box => {
                                const [x, y, scaleX, scaleY] = numbersOf(String(frame.transform));
                                return { x: laidOut.x + x, y: laidOut.y + y, width: laidOut.width * scaleX, height: laidOut.height * scaleY };
                            };
                            flight.firstKeyframe = at(frames[0]);
                            flight.lastKeyframe = at(frames[frames.length - 1]);
                        }
                        if (effect.target === layer && properties.includes('borderRadius') && !flight.corners) {
                            flight.corners = [String(frames[0].borderRadius), String(frames[frames.length - 1].borderRadius)];
                        }
                    }
                } else if (flight.appeared !== null) {
                    flight.gone = now - started;
                    observer.disconnect();
                    resolve(flight);
                    return;
                }
                if (now - started > limit) { observer.disconnect(); resolve(flight); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    }, [CARRIER, CARRIER_ROOT, covered, limitMs, source] as const)
);

/** The readings of the flight itself: from the carrier's first frame until shortly before it lands. */
const inTheAir = (flight: Flight) => flight.readings.filter(reading => reading.at - flight.appeared! < FLIGHT_MS - 40);

const read = (page: Page) => page.evaluate(() => (window as unknown as { __morphFlight: Promise<Flight> }).__morphFlight);

const boxOf = (locator: Locator) => locator.evaluate((element): Box => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
});
const apart = (left: Box, right: Box) => Math.max(
    Math.abs(left.x - right.x), Math.abs(left.y - right.y), Math.abs(left.width - right.width), Math.abs(left.height - right.height),
);
const centreOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** The figures a flight between two boxes is judged by. */
const figuresOf = (flight: Flight, source: Box, target: Box) => {
    const { readings } = flight;
    let path = 0;
    for (let index = 1; index < readings.length; index += 1) {
        const from = centreOf(readings[index - 1]);
        const to = centreOf(readings[index]);
        path += Math.hypot(to.x - from.x, to.y - from.y);
    }
    const straight = Math.hypot(centreOf(target).x - centreOf(readings[0]).x, centreOf(target).y - centreOf(readings[0]).y);
    const gaps = readings.slice(1).map((reading, index) => reading.at - readings[index].at);
    return {
        frames: readings.length,
        flightMs: Math.round((flight.gone ?? Number.NaN) - (flight.appeared ?? Number.NaN)),
        firstKeyframeOffSourcePx: Number(apart(flight.firstKeyframe!, source).toFixed(2)),
        lastKeyframeOffTargetPx: Number(apart(flight.lastKeyframe!, target).toFixed(2)),
        lastFrameOffTargetPx: Number(apart(readings[readings.length - 1], target).toFixed(2)),
        pathOverStraight: Number((path / straight).toFixed(3)),
        widthBeyondBothEndsPx: Number(Math.max(0, Math.max(...readings.map(reading => reading.width)) - Math.max(source.width, target.width)).toFixed(1)),
        heightBeyondBothEndsPx: Number(Math.max(0, Math.max(...readings.map(reading => reading.height)) - Math.max(source.height, target.height)).toFixed(1)),
        longestFrameMs: Number(Math.max(0, ...gaps).toFixed(1)),
        filters: [...new Set(readings.map(reading => reading.filter))],
        rotated: readings.some(reading => reading.rotated),
        animated: flight.animated.map(properties => properties.join('+')),
    };
};

/** A flight is what the compositor can carry: nothing but transform and opacity moves it. */
const expectCompositorOnly = (flight: Flight) => {
    const moving = flight.animated.filter(properties => !properties.every(name => name.startsWith('border')));
    expect(moving.length).toBeGreaterThan(0);
    for (const properties of moving) {
        expect(properties.every(name => name === 'transform' || name === 'opacity')).toBe(true);
    }
};

/**
 * The frame's edge over a flight recorded with the card it lands on: not lit at either end, lit
 * in the air, on the frame all the way, and moved by nothing the compositor cannot carry.
 */
const expectEdgeLit = (flight: Flight) => {
    const { readings } = flight;
    expect(readings.length).toBeGreaterThan(10);
    for (const reading of readings) expect(apart(reading.edge!, reading.frame!)).toBeLessThan(1);
    // In the air: until the card it lands on is shown again beneath it.
    const flying = readings.filter(reading => reading.coveredOpacity === '0');
    const lit = flying.map(reading => reading.edge!.opacity);
    expect(lit[0]).toBeLessThanOrEqual(0.05);
    expect(Math.max(...lit)).toBeGreaterThanOrEqual(0.85);
    expect(lit[lit.length - 1]).toBeLessThanOrEqual(0.1);
    // Landed: the carrier is the card it lies on, and no more.
    expect(readings.length).toBeGreaterThan(flying.length);
    for (const reading of readings.slice(flying.length)) expect(reading.edge!.opacity).toBe(0);
    // The line is the theme's text colour, which the probe sets apart from the colour its text is drawn in.
    expect(flight.edgeShadow).toContain('rgb(250, 250, 250)');
    expect(flight.edgeShadow).toContain('inset');
    expect(flight.edgeAnimated.map(properties => properties.join('+')).sort()).toEqual(['borderRadius', 'opacity', 'transform']);
    expectCompositorOnly(flight);
    return { first: lit[0], max: Math.max(...lit), last: lit[lit.length - 1], frames: lit.length };
};

const openFromHomeCard = async (root: Locator, page: Page) => {
    await root.locator('[data-probe-home-card]').click();
    await expect(root.locator('[data-probe-depth]')).toHaveAttribute('data-probe-depth', '1');
    await expect(page.locator(CARRIER)).toHaveCount(0, { timeout: 4000 });
};

test('the cover flies from the clicked card straight onto the stand-in, by transform alone', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    const source = await boxOf(root.locator(HOME_COVER));
    await record(page, STAND_IN, 6000, HOME_CARD);
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    const target = { x: 620, y: 420, width: 200, height: 200 };
    const figures = figuresOf(flight, source, target);
    // eslint-disable-next-line no-console
    console.log('FLIGHT open', JSON.stringify(figures));

    expect(flight.carriers).toBe(1);
    expect(flight.direction).toBe('in');
    // It starts on the card and ends on the stand-in, to the pixel.
    expect(figures.firstKeyframeOffSourcePx).toBeLessThan(0.6);
    expect(figures.lastKeyframeOffTargetPx).toBeLessThan(0.6);
    expect(figures.lastFrameOffTargetPx).toBeLessThan(1.5);
    // One straight way, with no stop at a guessed place: no detour, and never larger than both ends.
    expect(figures.pathOverStraight).toBeLessThan(1.02);
    expect(figures.widthBeyondBothEndsPx).toBeLessThan(2.5);
    expect(figures.heightBeyondBothEndsPx).toBeLessThan(2.5);
    // The card as it is: not blurred, not turned.
    expect(figures.filters).toEqual(['none']);
    expect(figures.rotated).toBe(false);
    expectCompositorOnly(flight);
    // It ends by itself, soon.
    expect(flight.gone).not.toBeNull();
    expect(figures.flightMs).toBeLessThan(900);

    // The cards at its two ends are not shown while the carrier is in the air.
    expect(new Set(inTheAir(flight).map(reading => reading.coveredOpacity))).toEqual(new Set(['0']));
    expect(new Set(inTheAir(flight).map(reading => reading.sourceOpacity))).toEqual(new Set(['0']));
    await expect(root.locator(STAND_IN_COVER).or(root.locator('[data-probe-detail-cover]')).first()).toBeVisible();
    await expect(root.locator('[data-probe-plan]')).toHaveAttribute('data-probe-plan', 'none');
});

test('the frame and the title fly with the cover, from the card\'s to the stand-in\'s', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    const homeFrame = await boxOf(root.locator('[data-probe-home-frame]'));
    const homeTitle = await boxOf(root.locator('[data-probe-home-title]'));
    await record(page, STAND_IN);
    await root.locator(HOME_CARD).click();
    const flight = await read(page);
    const first = flight.readings[0];
    const landed = flight.readings[flight.readings.length - 1];
    // The stand-in's frame is at 608 / 408, 224 wide; its title line 208 under the top of its cover.
    const standInFrame = { x: 608, y: 408, width: 224, height: 252 };

    // The first frame is the card (it has moved a frame's worth by the time it is read), the
    // last is the stand-in.
    expect(apart(first.frame!, homeFrame)).toBeLessThan(45);
    expect(apart(first.frame!, homeFrame)).toBeLessThan(apart(first.frame!, standInFrame));
    expect(apart(landed.frame!, standInFrame)).toBeLessThan(1.5);
    // Both cards draw a frame: it is there all the way.
    expect(new Set(flight.readings.map(reading => reading.frame!.opacity))).toEqual(new Set([1]));

    // Two lines, the card's and the stand-in's, at one place: the first is the card's own at
    // the start, the second the stand-in's own at the end, and one turns into the other.
    expect(first.titles.map(line => line.text)).toEqual(['Home Playlist', 'Home Playlist']);
    expect(Math.hypot(first.titles[0].x - homeTitle.x, first.titles[0].y - homeTitle.y)).toBeLessThan(45);
    expect(first.titles[0].opacity).toBe(1);
    expect(first.titles[1].opacity).toBe(0);
    expect(Math.hypot(landed.titles[1].x - 620, landed.titles[1].y - 628)).toBeLessThan(1.5);
    expect(landed.titles[1].opacity).toBe(1);
    expect(landed.titles[0].opacity).toBe(0);
    // Its letters are 16 high on the card and 14 on the stand-in: scaled, and by one factor both ways.
    expect(flight.readings.every(reading => reading.titles.every(line => line.even))).toBe(true);
    expect(first.titles[0].height).toBeGreaterThan(landed.titles[0].height);
    expectCompositorOnly(flight);
});

test('the frame\'s edge lights while the card is in the air, on the way in and on the way back', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await record(page, STAND_IN);
    await root.locator(HOME_CARD).click();
    const inward = await read(page);
    expect(inward.direction).toBe('in');
    // eslint-disable-next-line no-console
    console.log('EDGE open', JSON.stringify(expectEdgeLit(inward)));

    await expect(root.locator('[data-probe-detail-card]')).toHaveCount(1);
    await expect(root.locator(STAND_IN)).toHaveCount(0);
    await record(page, HOME_CARD);
    await root.locator('[data-probe-action="back"]').click();
    const outward = await read(page);
    expect(outward.direction).toBe('out');
    // eslint-disable-next-line no-console
    console.log('EDGE back', JSON.stringify(expectEdgeLit(outward)));
});

test('a wide cover lands on a square one without being stretched on the way', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    const source = await boxOf(root.locator('[data-probe-wide-card] img'));
    await record(page);
    await root.locator('[data-probe-wide-card]').click();
    const flight = await read(page);
    const figures = figuresOf(flight, source, { x: 620, y: 420, width: 200, height: 200 });
    // eslint-disable-next-line no-console
    console.log('FLIGHT wide', JSON.stringify(figures));

    expect(figures.firstKeyframeOffSourcePx).toBeLessThan(0.6);
    expect(figures.lastKeyframeOffTargetPx).toBeLessThan(0.6);
    // The box goes from 16:9 to square; the picture in it keeps its own 16:9 on every frame.
    const shapes = flight.readings.map(reading => reading.pictureShape!);
    expect(Math.min(...shapes)).toBeGreaterThan(16 / 9 - 0.02);
    expect(Math.max(...shapes)).toBeLessThan(16 / 9 + 0.02);
    // The corners go from the card's radius to the stand-in's, drawn round at both ends.
    expect(flight.corners).not.toBeNull();
    const [first, last] = flight.corners!.map(corner => (corner.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number));
    expect(first[0] * (source.width / 200)).toBeCloseTo(16, 0);
    expect(first[1] * (source.height / 200)).toBeCloseTo(16, 0);
    expect(last[0]).toBeCloseTo(8, 1);
    expectCompositorOnly(flight);
    // This card draws no frame of its own: the stand-in's comes in on the way.
    expect(flight.readings[0].frame!.opacity).toBeLessThan(0.3);
    expect(flight.readings[flight.readings.length - 1].frame!.opacity).toBe(1);
});

test('tracks that come late: the stand-in stays as the loading card and the cover flies once', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await root.locator('[data-probe-action="slow-tracks"]').click();
    await record(page, STAND_IN, 2600);
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    expect(flight.gone).not.toBeNull();
    expect(flight.gone!).toBeLessThan(1200);
    // Not shown while the carrier flew to it; shown again beneath the carrier when it had landed,
    // which then went over it.
    expect(new Set(inTheAir(flight).map(reading => reading.coveredOpacity))).toEqual(new Set(['0']));
    expect(flight.readings[flight.readings.length - 1].coveredOpacity).toBe('1');
    expect(await root.locator(STAND_IN).evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await expect(root.locator('[data-probe-stand-in-title]')).toHaveText('Home Playlist');

    // Landed, no card yet: the stand-in shows the picture that flew.
    await expect(root.locator('[data-probe-detail-card]')).toHaveCount(0);
    await expect(root.locator(STAND_IN_COVER)).toBeVisible();
    await expect(root.locator(STAND_IN_COVER)).toHaveAttribute('src', /home/);
    // The card comes, the stand-in goes, and no second carrier was put up meanwhile.
    await expect(root.locator('[data-probe-detail-card]')).toHaveCount(1, { timeout: 4000 });
    await expect(root.locator('[data-probe-stand-in]')).toHaveCount(0);
    expect(await page.locator(CARRIER).count()).toBe(0);
    expect(flight.carriers).toBe(1);
});

test('back: the cover at the middle flies back onto the card it was opened from', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    const home = await boxOf(root.locator(HOME_COVER));
    await openFromHomeCard(root, page);
    await expect(root.locator('[data-probe-detail-card]')).toHaveCount(1);
    await expect(root.locator('[data-probe-stand-in]')).toHaveCount(0);
    const centred = await boxOf(root.locator('[data-probe-detail-cover]'));

    await record(page, HOME_CARD);
    await root.locator('[data-probe-action="back"]').click();
    const flight = await read(page);
    const figures = figuresOf(flight, centred, home);
    // eslint-disable-next-line no-console
    console.log('FLIGHT back', JSON.stringify(figures));

    expect(flight.carriers).toBe(1);
    expect(flight.direction).toBe('out');
    expect(figures.firstKeyframeOffSourcePx).toBeLessThan(0.6);
    expect(figures.lastKeyframeOffTargetPx).toBeLessThan(0.6);
    expect(figures.pathOverStraight).toBeLessThan(1.02);
    expectCompositorOnly(flight);
    // The carrier turns into the card's own picture and title on the way, and the card is not
    // shown until it has landed.
    expect(new Set(inTheAir(flight).map(reading => reading.coveredOpacity))).toEqual(new Set(['0']));
    const landed = flight.readings[flight.readings.length - 1];
    expect(landed.titles.map(line => line.text)).toEqual(['Detail Song', 'Home Playlist']);
    expect(landed.titles.map(line => line.opacity)).toEqual([0, 1]);
    await expect(root.locator(HOME_COVER)).toBeVisible();
    await expect(root.locator('[data-probe-depth]')).toHaveAttribute('data-probe-depth', '0');
});

test('back: the page\'s other cards are pushed out from the one that flies, which is not shown beside its carrier', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await openFromHomeCard(root, page);
    await expect(root.locator('[data-probe-other-card]')).toHaveCount(4);
    await expect(root.locator(STAND_IN)).toHaveCount(0);

    // Read in the page, frame by frame, for as long as the page that is left is still there.
    await page.evaluate(() => {
        const centreOf = (element: Element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        };
        const centred = document.querySelector('[data-probe-detail-card]')!;
        const origin = centreOf(centred.querySelector('img')!);
        const others = [...document.querySelectorAll('[data-probe-other-card]')];
        const awayOf = (card: Element) => Math.hypot(centreOf(card).x - origin.x, centreOf(card).y - origin.y);
        const before = others.map(awayOf);
        const seen = { pushed: others.map(() => 0), centredOpacity: [] as string[], frames: 0, turned: false, leftFor: 0 };
        (window as unknown as { __scatter?: Promise<typeof seen> }).__scatter = new Promise((resolve) => {
            const began = performance.now();
            let leavingSince: number | null = null;
            const step = () => {
                // The page that leaves says so itself, from the commit that takes it off the navigation.
                if (centred.isConnected && document.querySelector('[data-probe-detail-grid] > [data-folia-leaving-grid]')) {
                    leavingSince ??= performance.now();
                    seen.leftFor = performance.now() - leavingSince;
                    seen.frames += 1;
                    seen.centredOpacity.push(getComputedStyle(centred).opacity);
                    others.forEach((card, index) => {
                        seen.pushed[index] = Math.max(seen.pushed[index], awayOf(card) - before[index]);
                        if (getComputedStyle(card).rotate !== 'none') seen.turned = true;
                    });
                }
                if (performance.now() - began > 900) { resolve(seen); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
    });
    await root.locator('[data-probe-action="back"]').click();
    const seen = await page.evaluate(() => (window as unknown as { __scatter: Promise<{ pushed: number[]; centredOpacity: string[]; frames: number; turned: boolean; leftFor: number }> }).__scatter);
    // eslint-disable-next-line no-console
    console.log('SCATTER', JSON.stringify({ ...seen, centredOpacity: [...new Set(seen.centredOpacity)] }));

    expect(seen.frames).toBeGreaterThan(5);
    // The page stays for as long as its cards are pushed (0.4 s), not for its usual 0.3 s.
    expect(seen.leftFor).toBeGreaterThan(360);
    // Every other card went outward, a good way, turned a little.
    for (const pushed of seen.pushed) expect(pushed).toBeGreaterThan(60);
    expect(seen.turned).toBe(true);
    expect(new Set(seen.centredOpacity)).toEqual(new Set(['0']));
});

test('an artist page: the cover lands on the round picture, and its corners end round', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await root.locator('[data-probe-action="destination"]').click();
    await expect(root.locator('[data-probe-destination]')).toHaveAttribute('data-probe-destination', 'artist');
    const source = await boxOf(root.locator(HOME_COVER));
    await record(page, '[data-probe-artist-avatar]');
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    // The picture inside its 4px ring: 232 across, at 604 / 434.
    const figures = figuresOf(flight, source, { x: 604, y: 434, width: 232, height: 232 });
    // eslint-disable-next-line no-console
    console.log('FLIGHT artist', JSON.stringify(figures));

    expect(figures.firstKeyframeOffSourcePx).toBeLessThan(0.6);
    expect(figures.lastKeyframeOffTargetPx).toBeLessThan(0.6);
    const [first, last] = flight.corners!.map(corner => (corner.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number));
    // From the card's 12px corners (as drawn: the box is laid out at 232 and scaled to 200) to a circle.
    expect(first[0] * (200 / 232)).toBeCloseTo(12, 0);
    expect(last[0]).toBeCloseTo(116, 0);
    expectCompositorOnly(flight);
    await expect(root.locator('[data-probe-artist-avatar] img')).toBeVisible();
});

test('a landing place that comes late: the cover waits where it was clicked, then flies', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await root.locator('[data-probe-action="destination"]').click();
    const source = await boxOf(root.locator(HOME_COVER));
    await record(page);
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    // The probe's artist page puts its picture up 150 ms after it opens. Until then the cover
    // stands on the card, unmoved; then one flight takes it to the picture.
    const waiting = flight.readings.filter(reading => apart(reading, source) < 0.6);
    expect(waiting.length).toBeGreaterThan(3);
    expect(waiting[waiting.length - 1].at - waiting[0].at).toBeGreaterThan(80);
    expect(flight.carriers).toBe(2);
    expect(apart(flight.lastKeyframe!, { x: 604, y: 434, width: 232, height: 232 })).toBeLessThan(0.6);
});

test('a landing place that never comes: the cover fades where it is, and nothing is left behind', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await root.locator('[data-probe-action="destination"]').click();
    await root.locator('[data-probe-action="slow-tracks"]').click();
    const source = await boxOf(root.locator(HOME_COVER));
    await record(page, null, 4000);
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    expect(flight.gone).not.toBeNull();
    // Waited its time out, then shrank about its own middle.
    expect(flight.gone! - flight.appeared!).toBeGreaterThan(1200);
    expect(flight.gone! - flight.appeared!).toBeLessThan(2400);
    const last = flight.readings[flight.readings.length - 1];
    expect(centreOf(last).x).toBeCloseTo(centreOf(source).x, 0);
    expect(centreOf(last).y).toBeCloseTo(centreOf(source).y, 0);
    expect(last.width).toBeLessThan(source.width - 10);
    // A card that waits, and one with nowhere to land, is not in the air: its edge is never lit.
    expect(new Set(flight.readings.map(reading => reading.edge!.opacity))).toEqual(new Set([0]));
    await expect(root.locator('[data-probe-plan]')).toHaveAttribute('data-probe-plan', 'none');
});

test('a nested back lands on the stand-in of the page before, which shows the card that was clicked', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await openFromHomeCard(root, page);
    await expect(root.locator('[data-probe-detail-card]')).toHaveCount(1);
    await expect(root.locator('[data-probe-stand-in]')).toHaveCount(0);

    // The song card opens the artist's page: its cover flies to the round picture.
    await record(page);
    await root.locator('[data-probe-detail-card]').click();
    const inward = await read(page);
    expect(inward.direction).toBe('in');
    expect(apart(inward.lastKeyframe!, { x: 604, y: 434, width: 232, height: 232 })).toBeLessThan(0.6);
    await expect(root.locator('[data-probe-depth]')).toHaveAttribute('data-probe-depth', '2');

    await record(page);
    await root.locator('[data-probe-action="back"]').click();
    const outward = await read(page);
    expect(outward.direction).toBe('out');
    expect(apart(outward.firstKeyframe!, { x: 604, y: 434, width: 232, height: 232 })).toBeLessThan(0.6);
    expect(apart(outward.lastKeyframe!, { x: 620, y: 420, width: 200, height: 200 })).toBeLessThan(0.6);
    await expect(root.locator('[data-probe-depth]')).toHaveAttribute('data-probe-depth', '1');
    // The page before is back with its card; while it waited, its stand-in showed that card's picture.
    await expect(root.locator('[data-probe-detail-card]')).toHaveCount(1, { timeout: 4000 });
});

test('the landing place is the active page\'s, though a page that is leaving has one too', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await record(page, '[data-probe-stale-target]');
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    expect(apart(flight.lastKeyframe!, { x: 620, y: 420, width: 200, height: 200 })).toBeLessThan(0.6);
    // The leaving page's picture was never taken for what the carrier lands on.
    expect(new Set(flight.readings.map(reading => reading.coveredOpacity))).toEqual(new Set(['1']));
});

test('reduced motion starts nothing: no carrier, no plan, no stand-in', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await root.locator('[data-probe-action="reduce"]').click();
    await expect(root.locator('[data-probe-enabled]')).toHaveAttribute('data-probe-enabled', 'false');
    await record(page, null, 900);
    await root.locator('[data-probe-home-card]').click();
    await expect(root.locator('[data-probe-depth]')).toHaveAttribute('data-probe-depth', '1');
    const flight = await read(page);
    expect(flight.carriers).toBe(0);
    await expect(root.locator('[data-probe-plan]')).toHaveAttribute('data-probe-plan', 'none');
    await expect(root.locator('[data-probe-stand-in]')).toHaveCount(0);
    await expect(root.locator('[data-probe-detail-card]')).toHaveCount(1);
});

test('switched off in mid-flight: the carrier goes at once and what it covered is shown', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await root.locator('[data-probe-action="slow-tracks"]').click();
    await page.evaluate(() => {
        // The flight lasts under half a second; it is switched off from inside the page, the
        // moment the carrier is put up.
        const observer = new MutationObserver(() => {
            if (!document.querySelector('[data-folia-collection-morph="cover"]')) return;
            observer.disconnect();
            document.querySelector<HTMLElement>('[data-probe-action="reduce"]')!.click();
        });
        observer.observe(document.body, { childList: true });
    });
    await record(page, null, 1500);
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    expect(flight.carriers).toBe(1);
    // Gone long before a whole flight would have ended, and the card it was flying to is shown with
    // that (read at once: left hidden, it would be shown some half a second later by the flight's own timer).
    expect(flight.gone! - flight.appeared!).toBeLessThan(200);
    expect(await root.locator(STAND_IN).evaluate(element => getComputedStyle(element).opacity)).toBe('1');
    await expect(root.locator('[data-probe-enabled]')).toHaveAttribute('data-probe-enabled', 'false');
    await expect(root.locator('[data-probe-plan]')).toHaveAttribute('data-probe-plan', 'none');
});

test('the page closed in mid-flight, not through the host: the carrier goes at once', async ({ mount, page }) => {
    const root = await mount('collectionMorph');
    await page.evaluate(() => {
        const observer = new MutationObserver(() => {
            if (!document.querySelector('[data-folia-collection-morph="cover"]')) return;
            observer.disconnect();
            document.querySelector<HTMLElement>('[data-probe-action="close-navigation"]')!.click();
        });
        observer.observe(document.body, { childList: true });
    });
    await record(page, HOME_COVER, 1500);
    await root.locator('[data-probe-home-card]').click();
    const flight = await read(page);
    expect(flight.carriers).toBe(1);
    expect(flight.gone! - flight.appeared!).toBeLessThan(200);
    await expect(root.locator('[data-probe-depth]')).toHaveAttribute('data-probe-depth', '0');
    await expect(root.locator(HOME_COVER)).toBeVisible();
    await expect(root.locator('[data-probe-plan]')).toHaveAttribute('data-probe-plan', 'none');
});

test('only the incoming grid carries the active mark while two grids overlap', async ({ mount, page }) => {
    // 这条盖的是标记组件本身在 AnimatePresence 里的翻转：带标记的那一层就是标记元素的父元素。
    const root = await mount('activeGridMarker');
    const active = page.locator('[data-probe-grid]:has(> [data-folia-active-grid])');

    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('data-probe-grid', 'grid-0');

    await root.locator('[data-probe-action="push"]').click();
    await expect(root.locator('[data-probe-level]')).toHaveAttribute('data-probe-level', '1');

    // 退出动画期间两层网格同时在 DOM 里：标记必须只在正在进入的那层上，
    // 否则移形换影的测量会量到正在消失的上一页。
    await expect(page.locator('[data-probe-grid]')).toHaveCount(2);
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('data-probe-grid', 'grid-1');

    await expect(page.locator('[data-probe-grid]')).toHaveCount(1);
    await expect(active).toHaveAttribute('data-probe-grid', 'grid-1');
});
