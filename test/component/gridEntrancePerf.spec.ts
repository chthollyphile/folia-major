import { expect, test } from './fixtures';

// test/component/gridEntrancePerf.spec.ts
// 大歌单打开的帧预算。为什么值得一条常驻用例：这块的成本是「几十张真实卡片同时挂载 +
// 同时做入场动画」，靠读代码判断不出主线程还剩多少，只能量。
//
// 断言的是**规模不变量**，不是精确时间：曲目数翻十倍，挂载的卡片数、主线程块、掉帧都不该
// 跟着涨（这才是「惰性塑形」修掉的东西）。绝对值在这台机器上会因为同时跑几个 worker 而翻倍，
// 所以判据写成两档之间的**差**，只兜一个很宽的天花板防灾难性回归。

type PerfReading = {
    longTaskTotal: number;
    longTaskMax: number;
    longTaskCount: number;
    frames: number;
    worstFrame: number;
    slowFrames: number;
    cards: number;
};

const readPerf = async (page: import('@playwright/test').Page): Promise<PerfReading | null> => {
    const raw = await page.locator('[data-probe-reading]').getAttribute('data-probe-reading');
    return raw ? JSON.parse(raw) as PerfReading : null;
};

const openAndMeasure = async (page: import('@playwright/test').Page, root: import('@playwright/test').Locator, count: number) => {
    await root.locator(`[data-probe-size="${count}"]`).click();
    await root.locator('[data-probe-action="open"]').click();
    await expect.poll(() => readPerf(page), { timeout: 20_000 }).not.toBeNull();
    return (await readPerf(page))!;
};

/** 先空跑一次丢掉读数：第一次挂载要付 JIT/CSS/图片解码的冷启动，不丢掉的话 A/B 比的是冷热。 */
const warmUp = async (page: import('@playwright/test').Page, root: import('@playwright/test').Locator) => {
    await openAndMeasure(page, root, 2000);
};

// The card whose entrance is followed: track 6, right of the centred card in this viewport. It is
// among the first to move, and it comes in level from the right, whole on the screen all the way
// (the screencast case finds it there by its cover).
const SAMPLED_CARD_ID = 'online:netease:1000006-0';

type FlyInRecording = {
    /** When the probe's open button was clicked. */
    clickedAt: number;
    /** The sampled card's centre against its slot's centre, one per frame from the first frame it is there. */
    samples: Array<{ t: number; dx: number; dy: number }>;
    opacityAtMount: number;
    longTasks: Array<{ start: number; duration: number }>;
    /** When each frame's callback ran. */
    frames: number[];
};

/**
 * Starts following one card in the page, frame by frame, from before the click that opens the
 * grid. A script can only see the frames the main thread makes, so what this gives is where the
 * card stood in each of those; what the screen showed between two of them it cannot tell.
 */
const startFlyInRecorder = (page: import('@playwright/test').Page) => page.evaluate((cardId) => {
    const recording: FlyInRecording = { clickedAt: 0, samples: [], opacityAtMount: 1, longTasks: [], frames: [] };
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            recording.longTasks.push({ start: entry.startTime, duration: entry.duration });
        }
    });
    observer.observe({ entryTypes: ['longtask'] });
    const onClick = (event: MouseEvent) => {
        if ((event.target as Element).closest('[data-probe-action]')) recording.clickedAt = performance.now();
    };
    document.addEventListener('click', onClick, true);

    // The grid before this opening has a card of the same track: the one followed is the first
    // new one after the click.
    let followed: Element | null = null;
    let raf = 0;
    const tick = () => {
        const now = performance.now();
        recording.frames.push(now);
        const slot = document.querySelector(`[data-folia-grid-item-id="${cardId}"]`);
        const card = slot?.firstElementChild;
        if (slot && card && recording.clickedAt > 0) {
            if (slot !== followed) {
                followed = slot;
                recording.samples = [];
                recording.opacityAtMount = Number(getComputedStyle(card).opacity);
            }
            const slotBox = slot.getBoundingClientRect();
            const cardBox = card.getBoundingClientRect();
            recording.samples.push({
                t: now,
                dx: cardBox.left + cardBox.width / 2 - slotBox.left - slotBox.width / 2,
                dy: cardBox.top + cardBox.height / 2 - slotBox.top - slotBox.height / 2,
            });
        }
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    (window as unknown as { stopFlyInRecorder: () => FlyInRecording }).stopFlyInRecorder = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        document.removeEventListener('click', onClick, true);
        return recording;
    };
}, SAMPLED_CARD_ID);

const stopFlyInRecorder = (page: import('@playwright/test').Page) => page.evaluate(() => (
    (window as unknown as { stopFlyInRecorder: () => FlyInRecording }).stopFlyInRecorder()
));

/** How long after the cards are there the entrance is looked at. */
const ENTRANCE_WINDOW_MS = 700;
/**
 * The probe's own window ends 1.6 s after the click, and its reading re-renders the grid. On a
 * slowed CPU the cards may come late enough for that to fall into their entrance: it is the
 * probe's doing, not the opening's, so the entrance is looked at no further than this.
 */
const PROBE_READING_AFTER_CLICK_MS = 1590;

const round = (value: number) => Math.round(value * 10) / 10;

/** The numbers of one opening, in milliseconds and pixels. */
const summarizeFlyIn = (recording: FlyInRecording) => {
    const { samples, frames, longTasks, clickedAt } = recording;
    if (samples.length < 2) return null;
    const mountedAt = samples[0].t;
    const windowEnd = Math.min(mountedAt + ENTRANCE_WINDOW_MS, clickedAt + PROBE_READING_AFTER_CLICK_MS);
    const tasksStartedIn = (from: number, to: number) => {
        const durations = longTasks.filter(task => task.start >= from && task.start < to).map(task => task.duration);
        return {
            count: durations.length,
            total: round(durations.reduce((sum, value) => sum + value, 0)),
            longest: round(Math.max(0, ...durations)),
        };
    };
    // A gap counts when any of it falls into the window.
    const gaps = frames.slice(1)
        .map((at, index) => ({ from: frames[index], at }))
        .filter(({ from, at }) => at > mountedAt && from < windowEnd)
        .map(({ from, at }) => at - from);

    // Under way: from the card's first move until it is within half a pixel of where it rests.
    // A standstill is the time it kept one place between two moves.
    const rest = samples[samples.length - 1];
    const fromRest = (sample: { dx: number; dy: number }) => Math.hypot(sample.dx - rest.dx, sample.dy - rest.dy);
    let startedAt: number | null = null;
    let lastMoveAt = 0;
    let standstill = 0;
    let arrived = false;
    for (let index = 1; index < samples.length && !arrived; index += 1) {
        if (samples[index - 1].t >= clickedAt + PROBE_READING_AFTER_CLICK_MS) break;
        const moved = Math.hypot(samples[index].dx - samples[index - 1].dx, samples[index].dy - samples[index - 1].dy) > 0.01;
        if (!moved) continue;
        if (startedAt === null) {
            startedAt = samples[index].t;
        } else {
            standstill = Math.max(standstill, samples[index].t - lastMoveAt);
        }
        lastMoveAt = samples[index].t;
        arrived = fromRest(samples[index]) <= 0.5;
    }
    return {
        /** From the click to the first frame with the card. */
        mountMs: round(mountedAt - clickedAt),
        /** Long tasks begun between the click and that frame, and in the window after it. */
        mountTasks: tasksStartedIn(clickedAt, mountedAt),
        entranceTasks: tasksStartedIn(mountedAt, windowEnd),
        windowMs: round(windowEnd - mountedAt),
        worstFrameGap: round(Math.max(0, ...gaps)),
        frameGapsOver34: gaps.filter(gap => gap > 34).length,
        /** How far from its place the card was when it came, and how see-through. */
        travel: round(fromRest(samples[0])),
        opacityAtMount: recording.opacityAtMount,
        /** From the first frame with the card to its first move: its delay, and whatever held it up. */
        startedAfterMount: startedAt === null ? null : round(startedAt - mountedAt),
        underWayMs: startedAt === null ? 0 : round(lastMoveAt - startedAt),
        /** False where the probe's reading came before the card was at rest. */
        arrived,
        longestStandstill: round(standstill),
    };
};

/**
 * One opening of the grid as the probe has it, with the sampled card followed through it.
 * 'open-landing' is the opening a cover flies to: its plan is taken back half a second after
 * the click, while cards still fly.
 */
const openAndFollow = async (
    page: import('@playwright/test').Page,
    root: import('@playwright/test').Locator,
    action: 'open' | 'open-landing' = 'open',
) => {
    await startFlyInRecorder(page);
    await root.locator(`[data-probe-action="${action}"]`).click();
    // The click takes the grid before it away at once; slowed, the new one's cards may come
    // seconds later, after the probe's reading (1.6 s after the click).
    await expect(root.locator(`[data-folia-grid-item-id="${SAMPLED_CARD_ID}"]`)).toBeAttached({ timeout: 30_000 });
    await expect.poll(() => readPerf(page), { timeout: 30_000 }).not.toBeNull();
    // Cards that came late are still on their way at the reading.
    await page.waitForTimeout(500);
    const flyIn = summarizeFlyIn(await stopFlyInRecorder(page));
    return { perf: (await readPerf(page))!, flyIn };
};

test('the grid mounts only the cards near the viewport, however big the playlist is', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf');
    await warmUp(page, root);
    const small = await openAndMeasure(page, root, 500);
    const large = await openAndMeasure(page, root, 5000);
    // eslint-disable-next-line no-console
    console.log('PERF cards', JSON.stringify({ small, large }));

    // 渲染环是「视口附近的卡」：曲目数翻十倍，挂载的卡片数不该跟着涨。
    expect(large.cards).toBeLessThan(small.cards * 1.5 + 10);
    // 塑形是惰性的：曲目数翻十倍，主线程块也不该跟着涨。
    // 判据写成「500 首与 5000 首的差」，而不是绝对毫秒 —— 这台机器同时跑几个 worker 时，
    // 连 500 首的挂载都会蹦到 200ms，绝对值判不出来是「大歌单的问题」还是「机器忙」。
    expect(large.longTaskMax - small.longTaskMax).toBeLessThan(150);
    // 再兜一个很宽的天花板：回归成整表塑形时（5000 首实测 ~700ms）这里会直接爆掉。
    expect(large.longTaskMax).toBeLessThan(400);
});

test('the entrance animation is not what eats the main thread', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf');
    await warmUp(page, root);
    await root.locator('[data-probe-size="2000"]').click();

    // 对照组：同样的挂载成本，不给入场计划（卡片走网格自带的入场：原地翻进来）。
    if (await root.locator('[data-probe-entrance]').getAttribute('data-probe-entrance') !== 'off') {
        await root.locator('[data-probe-entrance]').click();
    }
    const { perf: withoutEntrance, flyIn: controlCard } = await openAndFollow(page, root);

    await root.locator('[data-probe-entrance]').click();
    const { perf: withEntrance, flyIn: entranceCard } = await openAndFollow(page, root);

    // eslint-disable-next-line no-console
    console.log('PERF entrance', JSON.stringify({ withoutEntrance, withEntrance, controlCard, entranceCard }));

    // The comparison is only one if the two come differently. The control is the grid given no
    // plan: a card turns in where it stands, by the grid's own entrance (framer's, on the main
    // thread). With a plan a card flies in from away, by a Web Animation.
    // (The grid's own entrance did not play in a development build for as long as the grid made
    // its cards anew in every render: React renders twice there, and by the second time every
    // card had been "shown before". A production build always played it.)
    expect(controlCard!.travel).toBeLessThan(1);
    expect(controlCard!.opacityAtMount).toBeLessThan(0.1);
    expect(entranceCard!.travel).toBeGreaterThan(50);
    expect(entranceCard!.opacityAtMount).toBeLessThan(0.1);

    // 入场动画只该占一小部分：如果它成了主线程块的主因，说明「几十张卡各跑一条动画」又回来了。
    // 同样比「开/关的差」，机器忙的时候两边一起变慢，不该因此误报。
    expect(withEntrance.longTaskMax).toBeLessThan(withoutEntrance.longTaskMax + 120);
    expect(withEntrance.slowFrames).toBeLessThan(withoutEntrance.slowFrames + 6);
});

test('paging the rest of a big playlist in the background does not cost frames', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf');
    await warmUp(page, root);
    const setPaging = async (on: boolean) => {
        if ((await root.locator('[data-probe-paging]').getAttribute('data-probe-paging')) !== (on ? 'on' : 'off')) {
            await root.locator('[data-probe-paging]').click();
        }
    };

    await setPaging(false);
    const atOnce = await openAndMeasure(page, root, 5000);
    await setPaging(true);
    const paged = await openAndMeasure(page, root, 5000);
    // eslint-disable-next-line no-console
    console.log('PERF paging', JSON.stringify({ atOnce, paged }));

    // 分页按后台更新提交（transition），每页重算网格项也只塑形视口附近的卡：五次整表更新落在测量窗口里，
    // 主线程块与掉帧都不该比「一次给全」明显变多。同样比差值，不比绝对值。
    expect(paged.longTaskMax - atOnce.longTaskMax).toBeLessThan(150);
    expect(paged.slowFrames - atOnce.slowFrames).toBeLessThan(6);
    expect(paged.cards).toBeLessThan(atOnce.cards * 1.5 + 10);
});

// What the main thread does while the cards fly in, and what a script sees of one of them: long
// tasks, the gaps between frames, and how long the card kept one place. Numbers to read, for the
// two kinds of opening, at full speed and with the CPU slowed 4x; what is asserted is only that
// the card is at the start of its entrance in the first frame it is there.
test('a fly-in card followed through an opening, at full speed and with the CPU slowed 4x', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf');
    await warmUp(page, root);
    const cdp = await page.context().newCDPSession(page);

    for (const rate of [1, 4]) {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate });
        for (const action of ['open', 'open-landing'] as const) {
            for (let opening = 0; opening < 3; opening += 1) {
                const { flyIn } = await openAndFollow(page, root, action);
                // eslint-disable-next-line no-console
                console.log(`PERF fly-in ${action} cpu/${rate}`, JSON.stringify(flyIn));
                expect(flyIn).not.toBeNull();
                // A page a cover flies to may have lost its plan before its cards came (slowed,
                // they come after the half second), and then they do not fly in.
                if (action === 'open') {
                    expect(flyIn!.travel).toBeGreaterThan(50);
                    expect(flyIn!.opacityAtMount).toBeLessThan(0.1);
                }
            }
        }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

type FlyInBlock = {
    /** When the main thread was held, by the wall clock, to set against the screencast's times. */
    start: number;
    end: number;
    /** Where on the screen the sampled card comes from and where it rests, as one box. */
    region: { x: number; y: number; width: number; height: number } | null;
    /** The Web Animations on the sampled card as the block begins. */
    animations: Array<{ properties: string[]; playState: string }>;
};

const BLOCK_AFTER_MOUNT_MS = 40;
const BLOCK_MS = 250;

/**
 * Has the page hold its main thread, for BLOCK_MS, from BLOCK_AFTER_MOUNT_MS after the first
 * frame with the sampled card of the next opening: about when that card's delay is over.
 */
const armMainThreadBlock = (page: import('@playwright/test').Page) => page.evaluate(([cardId, afterMs, lengthMs]) => {
    const block: FlyInBlock = { start: 0, end: 0, region: null, animations: [] };
    (window as unknown as { flyInBlock: FlyInBlock }).flyInBlock = block;
    const selector = `[data-folia-grid-item-id="${cardId}"]`;
    const before = document.querySelector(selector);
    let mountedAt = 0;
    let from: DOMRect | null = null;
    const tick = () => {
        const slot = document.querySelector(selector);
        const card = slot?.firstElementChild;
        if (slot && card && slot !== before) {
            if (mountedAt === 0) {
                mountedAt = performance.now();
                from = card.getBoundingClientRect();
            }
            if (performance.now() - mountedAt >= afterMs) {
                const rest = slot.getBoundingClientRect();
                const left = Math.min(from!.left, rest.left);
                const top = Math.min(from!.top, rest.top);
                block.region = {
                    x: left,
                    y: top,
                    width: Math.max(from!.right, rest.right) - left,
                    height: Math.max(from!.bottom, rest.bottom) - top,
                };
                block.animations = card.getAnimations().map(animation => ({
                    properties: Object.keys((animation.effect as KeyframeEffect).getKeyframes()[0] ?? {})
                        .filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)),
                    playState: animation.playState,
                }));
                block.start = Date.now();
                const until = performance.now() + lengthMs;
                while (performance.now() < until) {
                    // Hold the main thread.
                }
                block.end = Date.now();
                return;
            }
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}, [SAMPLED_CARD_ID, BLOCK_AFTER_MOUNT_MS, BLOCK_MS] as const);

/**
 * Where the sampled card's cover is in each screencast picture, within `region`: how many of
 * its pixels are light, and their middle. The page is dark and a cover is a light square (the
 * probe's cards show the placeholder), by far the largest light area of the region; a card of
 * the next ring shows at the region's far edge once it has landed, and pulls the middle a little.
 */
const findCover = (page: import('@playwright/test').Page, pictures: string[], region: NonNullable<FlyInBlock['region']>) => (
    page.evaluate(async ({ pictures, region }) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const found: Array<{ pixels: number; x: number; y: number }> = [];
        for (const picture of pictures) {
            const image = new Image();
            image.src = `data:image/jpeg;base64,${picture}`;
            await image.decode();
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            context.drawImage(image, 0, 0);
            const scale = image.naturalWidth / window.innerWidth;
            const left = Math.max(0, Math.floor(region.x * scale));
            const top = Math.max(0, Math.floor(region.y * scale));
            const width = Math.min(canvas.width, Math.ceil((region.x + region.width) * scale)) - left;
            const height = Math.min(canvas.height, Math.ceil((region.y + region.height) * scale)) - top;
            const data = context.getImageData(left, top, width, height).data;
            let pixels = 0;
            let sumX = 0;
            let sumY = 0;
            for (let index = 0; index < width * height; index += 1) {
                if (Math.min(data[index * 4], data[index * 4 + 1], data[index * 4 + 2]) > 45) {
                    pixels += 1;
                    sumX += index % width;
                    sumY += Math.floor(index / width);
                }
            }
            found.push(pixels > 0
                ? { pixels, x: (left + sumX / pixels) / scale, y: (top + sumY / pixels) / scale }
                : { pixels: 0, x: 0, y: 0 });
        }
        return found;
    }, { pictures, region })
);

// A script sees only the frames the main thread makes, so whether the cards keep moving while
// the main thread is held has to be read off the screen: a screencast across a block, and where
// the sampled card's cover is in the pictures taken inside it.
test('the cards keep flying in on the screen while the main thread is held', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf');
    await warmUp(page, root);
    const cdp = await page.context().newCDPSession(page);
    const pictures: Array<{ at: number; data: string }> = [];
    cdp.on('Page.screencastFrame', (frame) => {
        pictures.push({ at: (frame.metadata.timestamp ?? Date.now() / 1000) * 1000, data: frame.data });
        void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });

    await armMainThreadBlock(page);
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, everyNthFrame: 1 });
    await root.locator('[data-probe-action="open"]').click();
    const readBlock = () => page.evaluate(() => (window as unknown as { flyInBlock: FlyInBlock }).flyInBlock);
    await expect.poll(async () => (await readBlock()).end, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await cdp.send('Page.stopScreencast');
    const block = await readBlock();

    // A frame the main thread made just before it was held may reach the screen a little into
    // the block; past this much of it, what changes on the screen is the compositor's.
    const settled = block.start + 40;
    const near = pictures.filter(picture => picture.at > block.start - 60 && picture.at < block.end + 120);
    const covers = await findCover(page, near.map(picture => picture.data), block.region!);
    const seen = near.map((picture, index) => ({ at: Math.round(picture.at - block.start), ...covers[index] }));
    // A cover that is there enough to place: some part of one, not a trace of its edge.
    const inside = seen.filter(picture => picture.at > settled - block.start && picture.at < block.end - block.start && picture.pixels > 2000);
    const moved = inside.length > 1
        ? Math.hypot(inside[inside.length - 1].x - inside[0].x, inside[inside.length - 1].y - inside[0].y)
        : 0;
    // eslint-disable-next-line no-console
    console.log('PERF held', JSON.stringify({
        blockMs: block.end - block.start,
        animations: block.animations,
        picturesInside: seen.filter(picture => picture.at > settled - block.start && picture.at < block.end - block.start).length,
        placedInside: inside.length,
        moved: Math.round(moved),
        seen: seen.map(picture => `${picture.at}:${picture.pixels}@${Math.round(picture.x)},${Math.round(picture.y)}`),
    }));

    expect(inside.length).toBeGreaterThan(2);
    expect(moved).toBeGreaterThan(20);
});

// The stand-in of a page a cover flies to: the real GridView puts it where its centred card
// stands, and takes it away once the flight is over and the cards are there.
test('a page opened for a flying cover puts a stand-in on its centred card, and takes it away', async ({ mount, page }) => {
    // A picture that nothing else on the page shows (the collection's own cover is blue, the tracks' green).
    const FLOWN = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#c2255c"/></svg>')}`;
    const root = await mount('gridEntrancePerf', { flownCover: FLOWN });
    await root.locator('[data-probe-action="open-landing"]').click();

    // Read in the page, on the first frames: the stand-in is there with the page, showing the
    // picture that flies; the centred card comes up beneath it.
    const seen = await page.evaluate(async () => {
        const boxOf = (element: Element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        };
        const started = performance.now();
        let first: { at: number; src: string | null; title: string | null } | null = null;
        while (performance.now() - started < 1500) {
            const target = document.querySelector('[data-folia-morph-target]');
            if (target && !first) {
                first = {
                    at: performance.now() - started,
                    src: target.querySelector('img')?.getAttribute('src') ?? null,
                    // The stand-in is a card: a frame around the place the cover lands on, with a title line in it.
                    title: target.closest('[data-folia-morph-frame]')?.querySelector('[data-folia-card-title]')?.textContent ?? null,
                };
            }
            const cards = [...document.querySelectorAll('[data-folia-grid-item-id]')];
            if (target && cards.length > 0) {
                const middle = { x: window.innerWidth / 2, y: boxOf(target).y + boxOf(target).height / 2 };
                const centred = cards
                    .map(card => ({ card, box: boxOf(card) }))
                    .filter(({ box }) => box.width > 0)
                    .sort((left, right) => (
                        Math.hypot(left.box.x + left.box.width / 2 - middle.x, left.box.y + left.box.height / 2 - middle.y)
                        - Math.hypot(right.box.x + right.box.width / 2 - middle.x, right.box.y + right.box.height / 2 - middle.y)
                    ))[0];
                const cover = centred.card.querySelector('img') ?? centred.card.querySelector('[class*="aspect-square"]');
                return { first, standIn: boxOf(target), card: cover ? boxOf(cover) : null, cardFrame: centred.box };
            }
            await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
        }
        return { first, standIn: null, card: null, cardFrame: null };
    });
    // eslint-disable-next-line no-console
    console.log('STAND-IN', JSON.stringify(seen));

    expect(seen.first).not.toBeNull();
    expect(seen.first!.src).toBe(FLOWN);
    expect(seen.first!.title).toBe('Clicked Card');
    expect(seen.standIn).not.toBeNull();
    expect(seen.card).not.toBeNull();
    // Its cover is where the centred card's cover is: the same width at the same left edge. A
    // card grows downwards with the lines of its title, and is centred by its height, so the two
    // covers may stand some pixels apart vertically.
    expect(Math.abs(seen.standIn!.x - seen.card!.x)).toBeLessThan(2);
    expect(Math.abs(seen.standIn!.width - seen.card!.width)).toBeLessThan(2);
    expect(Math.abs(seen.standIn!.y - seen.card!.y)).toBeLessThan(40);

    // The plan is taken back after half a second: the stand-in goes, the cards stay.
    await expect(page.locator('[data-folia-morph-target]')).toHaveCount(0, { timeout: 4000 });
    expect(await page.locator('[data-folia-grid-item-id]').count()).toBeGreaterThan(5);
});

// What the landing costs the cards. The flight's plan is taken back at landing, and the stand-in
// leaves the page a little later, in the middle of the turn that hands it over: two renders of
// the page that change nothing about any card. The cards were made anew in each of them, every
// one, for as long as the page was given a new empty list of `items` in every render.
test('the landing and the stand-in\'s leaving do not render the cards again', async ({ mount, page }) => {
    const root = await mount('gridEntrancePerf');
    await warmUp(page, root);
    await root.locator('[data-probe-action="open-landing"]').click();
    await expect(page.locator('[data-folia-morph-target]')).toHaveCount(0, { timeout: 4000 });

    const { commits, landedAt } = await page.evaluate(() => {
        const read = window as unknown as { __gridCommits: Array<{ startedAt: number; renderMs: number }>; __landedAt: number };
        return { commits: read.__gridCommits, landedAt: read.__landedAt };
    });
    // Timed from the landing: the probe's stamp, which it takes in the commit that takes the plan back.
    const timed = commits.map(commit => ({ at: Math.round(commit.startedAt - landedAt), renderMs: Number(commit.renderMs.toFixed(1)) }));
    // That commit is the last whose render began before the stamp.
    const landing = timed.filter(commit => commit.at <= 0).length - 1;
    // The render that mounts the cards: the longest of the opening, before the flight lands.
    const mount79 = Math.max(...timed.slice(0, landing).map(commit => commit.renderMs));
    // The stand-in leaves 210 ms after the landing (70 ms, then the 140 ms it turns away in).
    // The hero comes to rest 260 ms after that, and the page then does render its cards again,
    // for a plan that is over.
    const leaving = timed.slice(landing + 1).filter(commit => commit.at < 420);
    // eslint-disable-next-line no-console
    console.log('COMMITS', JSON.stringify({ mount79, landing: timed[landing], leaving, all: timed }));

    expect(landing).toBeGreaterThan(0);
    expect(leaving.length).toBeGreaterThan(0);
    // With the fault a render of these cost about what the mount costs (137 to 250 ms here);
    // without it, 4 to 33 ms.
    for (const commit of [timed[landing], ...leaving]) expect(commit.renderMs).toBeLessThan(mount79 / 2);
});
