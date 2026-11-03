'use strict';

// dev/perf/app/probe.cjs
// The recorder inside the app's page. dev/perf/app/guard.cjs registers it as a preload script of
// the session, so it runs before the page's first instruction, in Electron's isolated world: it
// shares the page's document, events and clock, and none of its variables. It only watches, with
// one exception: it puts stand-ins for the system's file and folder pickers into the page, so that
// none can open on the desktop. What else it adds to the page is one object, `window.__perfApp`,
// for dev/perf/app/run.mjs to ask.
//
// All times are milliseconds on the page's own clock (performance.now(), 0 = the navigation's
// start); `timeOrigin` turns them into wall-clock time for the main process's notes.

(() => {
    const { contextBridge, webFrame } = require('electron');

    // The system's file and folder pickers are Chromium's own windows: the guard in the main process
    // has no stand-in for them, and one that opened would wait on the desktop for the owner. In
    // every page they answer as if the person had closed them. (The import of the music folder puts
    // its one answer in front of this: dev/perf/app/drive.mjs.)
    void webFrame.executeJavaScript(`for (const name of ['showDirectoryPicker', 'showOpenFilePicker', 'showSaveFilePicker']) {
        if (typeof window[name] === 'function') {
            window[name] = () => Promise.reject(new DOMException('The perf guard opens no picker.', 'AbortError'));
        }
    }`);

    // The rest is for the app's own page only: not its frames, not the remote-control or the mod-export page.
    if (window.top !== window || !/\/index\.html$/.test(location.pathname)) {
        return;
    }
    const search = new URLSearchParams(location.search);
    if (search.has('remote') || search.has('obs')) {
        return;
    }

    const now = () => performance.now();
    const round = value => Math.round(value * 10) / 10;

    // What the recorder itself costs. It runs on the page's main thread, inside every time it
    // measures, so it times its own work while the app starts (`own`) and its look of every frame
    // of an action (`look`, further down), and both are in the results.
    const own = { ms: 0, calls: 0, log: [] };
    /** The same function, with the time it takes added to `own`. */
    const counted = work => (...args) => {
        const began = performance.now();
        try {
            return work(...args);
        } finally {
            own.ms += performance.now() - began;
            own.calls += 1;
        }
    };
    const shortUrl = url => String(url ?? '').replace(/^blob:.*\//, 'blob:').replace(/^.*\/assets\//, 'assets/').slice(-70);

    // ---------------------------------------------------------------------------------------------
    // Always on: long tasks, long frames, paints, media events, input events
    // ---------------------------------------------------------------------------------------------

    const longTasks = [];
    const longFrames = [];
    const paints = {};
    const eventTimings = [];
    let largestPaint = null;
    const observe = (type, onEntry, extra = {}) => {
        try {
            new PerformanceObserver(counted(list => list.getEntries().forEach(onEntry))).observe({ type, buffered: true, ...extra });
        } catch {
            // This engine does not report the type; the numbers that rest on it stay empty.
        }
    };
    observe('longtask', (entry) => {
        longTasks.push({ start: entry.startTime, duration: entry.duration });
        if (longTasks.length > 4000) {
            longTasks.splice(0, 1000);
        }
    });
    observe('long-animation-frame', (entry) => {
        longFrames.push({
            start: entry.startTime,
            duration: entry.duration,
            blocking: entry.blockingDuration,
            scripts: (entry.scripts ?? []).map(script => ({
                name: `${script.invoker || script.name || ''} ${script.sourceFunctionName || ''} ${shortUrl(script.sourceURL)}`.trim().slice(0, 160),
                duration: script.duration,
                forcedStyleAndLayout: script.forcedStyleAndLayoutDuration,
            })).sort((left, right) => right.duration - left.duration).slice(0, 4),
        });
        if (longFrames.length > 4000) {
            longFrames.splice(0, 1000);
        }
    });
    observe('paint', (entry) => { paints[entry.name] = entry.startTime; });
    observe('largest-contentful-paint', (entry) => { largestPaint = { at: entry.startTime, size: entry.size, tag: entry.element?.tagName ?? '' }; });
    observe('event', (entry) => {
        if (entry.name === 'click' || entry.name === 'keydown' || entry.name === 'pointerdown') {
            eventTimings.push({ name: entry.name, start: entry.startTime, processingStart: entry.processingStart, processingEnd: entry.processingEnd, duration: entry.duration });
            if (eventTimings.length > 500) {
                eventTimings.splice(0, 100);
            }
        }
    }, { durationThreshold: 16 });

    const media = [];
    ['loadstart', 'loadedmetadata', 'canplay', 'play', 'playing', 'waiting', 'pause', 'emptied', 'ended', 'error', 'seeking'].forEach((type) => {
        document.addEventListener(type, (event) => {
            const element = event.target;
            if (!(element instanceof HTMLMediaElement)) {
                return;
            }
            media.push({ type, at: now(), tag: element.tagName, src: shortUrl(element.currentSrc), currentTime: round(element.currentTime * 1000) / 1000, readyState: element.readyState });
            if (media.length > 2000) {
                media.splice(0, 500);
            }
        }, true);
    });

    const inputs = [];
    ['pointerdown', 'click', 'keydown'].forEach((type) => {
        window.addEventListener(type, (event) => {
            if (!event.isTrusted) {
                return;
            }
            inputs.push({ type, at: event.timeStamp, handledAt: now(), key: event.key ?? '' });
            if (inputs.length > 500) {
                inputs.splice(0, 100);
            }
        }, true);
    });

    // ---------------------------------------------------------------------------------------------
    // Start-up: when the app's first screen is in the page, and when the home page can be used
    // ---------------------------------------------------------------------------------------------

    const marks = {};
    const mark = (name, at = now()) => {
        if (!(name in marks)) {
            marks[name] = at;
        }
    };
    mark('probe-loaded');

    let lastImageAt = 0;
    let imagesLoaded = 0;
    let imagesFailed = 0;
    /** When each picture finished loading (or failed): asked later for the pictures that are inside the window. */
    const imageDoneAt = new WeakMap();
    // (Both hear every file the page loads, not only pictures: counted.)
    document.addEventListener('load', counted((event) => {
        if (event.target instanceof HTMLImageElement) {
            lastImageAt = now();
            imageDoneAt.set(event.target, lastImageAt);
            imagesLoaded += 1;
        }
    }), true);
    document.addEventListener('error', counted((event) => {
        if (event.target instanceof HTMLImageElement) {
            lastImageAt = now();
            imageDoneAt.set(event.target, lastImageAt);
            imagesFailed += 1;
        }
    }), true);

    const startupWatch = new MutationObserver(counted(() => {
        const root = document.getElementById('root');
        const splash = document.getElementById('app-splash');
        if (document.body && !('body' in marks)) {
            mark('body');
        }
        if (root?.firstElementChild) {
            mark('root-mounted');
        }
        if (splash?.classList.contains('is-hiding')) {
            mark('splash-hiding');
        }
        if ('root-mounted' in marks && !splash) {
            mark('splash-removed');
            startupWatch.disconnect();
        }
    }));
    startupWatch.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    /**
     * The pictures inside the window that have an address: how many, how many have not finished
     * loading, and when the last of those that have did (0 when none has).
     */
    const picturesPending = () => {
        let pending = 0;
        let shown = 0;
        let lastDoneAt = 0;
        for (const image of document.images) {
            if (!image.currentSrc && !image.getAttribute('src')) {
                continue;
            }
            const box = image.getBoundingClientRect();
            if (box.width === 0 || box.height === 0 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) {
                continue;
            }
            shown += 1;
            if (!image.complete) {
                pending += 1;
            } else {
                lastDoneAt = Math.max(lastDoneAt, imageDoneAt.get(image) ?? 0);
            }
        }
        return { pending, shown, lastDoneAt };
    };

    const QUIET_MS = 1000;
    /**
     * How many pictures the first page shows once it is whole: counted when the profile was
     * prepared (dev/perf/app/run.mjs) and handed over by the launch. The page is not called usable
     * with fewer: a library whose covers come late, with the main thread quiet meanwhile, would
     * otherwise be "usable" with none of them. 0 (a profile without a library): any number will do.
     */
    const PICTURES_WANTED = Number(process.env.PERF_APP_HOME_PICTURES) || 0;
    const usable = { at: null, picturesIn: null, quietFrom: null, picturesShown: 0, picturesWanted: PICTURES_WANTED, recorderMs: null, decidedAt: null };
    let picturesIdleSince = null;
    const usableTimer = setInterval(counted(() => {
        const at = now();
        // The recorder's own time so far, ten times a second: read back for the moment the page was usable.
        own.log.push([at, own.ms]);
        if (!('root-mounted' in marks)) {
            return;
        }
        const { pending, shown, lastDoneAt } = picturesPending();
        usable.picturesShown = shown;
        if (pending > 0 || shown < PICTURES_WANTED) {
            picturesIdleSince = null;
        } else if (picturesIdleSince === null) {
            picturesIdleSince = at;
        }
        const lastTask = longTasks.length ? longTasks[longTasks.length - 1] : null;
        const lastTaskEnd = lastTask ? lastTask.start + lastTask.duration : 0;
        const picturesQuiet = picturesIdleSince !== null && at - Math.max(picturesIdleSince, lastDoneAt) >= QUIET_MS;
        const threadQuiet = at - lastTaskEnd >= QUIET_MS && at - marks['root-mounted'] >= QUIET_MS;
        if (picturesQuiet && threadQuiet) {
            // The last picture inside the window, not the last one anywhere in the page.
            usable.picturesIn = shown > 0 && lastDoneAt > 0 ? lastDoneAt : null;
            usable.quietFrom = Math.max(marks['root-mounted'], lastTaskEnd);
            usable.at = Math.max(usable.picturesIn ?? 0, usable.quietFrom);
            // What the recorder had spent of the main thread by then (to the tenth of a second: the last note before that moment).
            usable.recorderMs = round(own.log.filter(([notedAt]) => notedAt <= usable.at).pop()?.[1] ?? 0);
            usable.decidedAt = at;
            clearInterval(usableTimer);
        }
    }), 100);

    const startup = () => {
        const navigation = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource').map(entry => ({
            name: shortUrl(entry.name),
            type: entry.initiatorType,
            start: round(entry.startTime),
            end: round(entry.responseEnd),
            bytes: entry.decodedBodySize || entry.transferSize || 0,
        }));
        return {
            timeOrigin: performance.timeOrigin,
            now: now(),
            marks: Object.fromEntries(Object.entries(marks).map(([name, at]) => [name, round(at)])),
            paints: Object.fromEntries(Object.entries(paints).map(([name, at]) => [name, round(at)])),
            largestPaint,
            navigation: navigation ? {
                responseEnd: round(navigation.responseEnd),
                domInteractive: round(navigation.domInteractive),
                domContentLoaded: round(navigation.domContentLoadedEventEnd),
                loadEvent: round(navigation.loadEventEnd),
            } : null,
            usable: { ...usable },
            images: { loaded: imagesLoaded, failed: imagesFailed, lastAt: round(lastImageAt) },
            longTasks: longTasks.map(task => ({ start: round(task.start), duration: round(task.duration) })),
            longFrames: longFrames.map(frame => ({ start: round(frame.start), duration: round(frame.duration), blocking: round(frame.blocking), scripts: frame.scripts.map(script => ({ ...script, duration: round(script.duration), forcedStyleAndLayout: round(script.forcedStyleAndLayout) })) })),
            resources,
            serviceWorker: 'serviceWorker' in navigator ? { controlled: Boolean(navigator.serviceWorker.controller) } : null,
        };
    };

    // ---------------------------------------------------------------------------------------------
    // Finding things in the page
    // ---------------------------------------------------------------------------------------------

    const isShown = (element) => {
        const box = element.getBoundingClientRect();
        if (box.width < 1 || box.height < 1 || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) {
            return false;
        }
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.01;
    };
    const textOf = element => (element.innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
    /** An element's text without asking for layout (innerText does). */
    const wholeText = element => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const describe = (element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
            // False when something else lies over the element's centre: a click there would not reach it.
            reachable: Boolean(top && (top === element || element.contains(top) || top.contains(element))),
            tag: element.tagName.toLowerCase(),
            testId: element.getAttribute('data-testid') ?? '',
            label: element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '',
            text: textOf(element).slice(0, 60),
            x: Math.round(box.left + box.width / 2),
            y: Math.round(box.top + box.height / 2),
            width: Math.round(box.width),
            height: Math.round(box.height),
        };
    };
    /**
     * The elements a query means, in document order: `selector` (CSS), narrowed by `text` (the
     * element's visible text contains it), `label` (its aria-label or title contains it) and
     * `shown` (it is inside the window and not hidden; on unless set to false). With `closest`
     * the answer is not the element itself but the nearest element around it that matches that
     * selector (the layer a button sits in).
     */
    const findAll = (query) => {
        const found = [];
        for (const matched of document.querySelectorAll(query.selector ?? '*')) {
            const element = matched;
            if (query.label !== undefined) {
                // A button is named by its aria-label or by its title; the app uses either.
                const names = [element.getAttribute('aria-label') ?? '', element.getAttribute('title') ?? ''];
                if (!names.some(name => (query.labelExact ? name === query.label : name.includes(query.label)))) {
                    continue;
                }
            }
            if (query.text !== undefined) {
                // By textContent: it needs no layout, so a watch may ask this every frame.
                const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
                if (!(query.exact ? text === query.text : text.includes(query.text))) {
                    continue;
                }
            }
            const answer = query.closest ? element.closest(query.closest) : element;
            if (!answer || found.includes(answer)) {
                continue;
            }
            if (query.shown !== false && !isShown(answer)) {
                continue;
            }
            found.push(answer);
        }
        return found;
    };
    const find = (query) => {
        const all = findAll(query);
        return all[query.nth ?? 0] ?? null;
    };

    // ---------------------------------------------------------------------------------------------
    // One action: from an input to what it changes on screen
    // ---------------------------------------------------------------------------------------------

    let action = null;
    let frameLoop = 0;

    const holds = (watch, state) => {
        if (watch.kind === 'present') {
            return find(watch) !== null;
        }
        if (watch.kind === 'gone') {
            return find(watch) === null;
        }
        if (watch.kind === 'all') {
            return watch.of.every(part => holds(part, state));
        }
        if (watch.kind === 'any') {
            return watch.of.some(part => holds(part, state));
        }
        if (watch.kind === 'pictures') {
            // At least `min` pictures are inside the window and every one of them has finished loading.
            const { pending, shown } = picturesPending();
            return shown >= (watch.min ?? 1) && pending === 0;
        }
        if (watch.kind === 'text') {
            // A piece of text in the page that is exactly one of `texts`, inside `scope`, and not hidden.
            for (const scope of document.querySelectorAll(watch.scope ?? '#root')) {
                const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
                // The pieces of one element follow each other: its whole text is put together once, not once a piece.
                let parent = null;
                let whole = '';
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    if (!node.parentElement) {
                        continue;
                    }
                    if (node.parentElement !== parent) {
                        parent = node.parentElement;
                        whole = wholeText(parent);
                    }
                    if ((watch.texts.includes(node.nodeValue.trim()) || watch.texts.includes(whole)) && isShown(parent)) {
                        return true;
                    }
                }
            }
            return false;
        }
        if (watch.kind === 'style') {
            // A computed style of one element: `above` / `below` for a number, `equals` for a word.
            const element = find({ ...watch, shown: false });
            if (!element) {
                return false;
            }
            const value = getComputedStyle(element)[watch.property];
            if (watch.equals !== undefined) {
                return value === watch.equals;
            }
            return (watch.above === undefined || Number(value) > watch.above) && (watch.below === undefined || Number(value) < watch.below);
        }
        if (watch.kind === 'audio') {
            // Since the input an audio element was given a source ('loadstart'), has said it plays
            // ('playing'), and an element's clock is past zero and running.
            if (state.t0 === null || state.t0 === undefined) {
                return false;
            }
            const since = media.slice(state.mediaFrom);
            const given = since.findIndex(event => event.type === 'loadstart' && event.at >= state.t0);
            if (given < 0 || !since.slice(given).some(event => event.type === 'playing')) {
                return false;
            }
            for (const element of document.querySelectorAll('audio')) {
                if (!element.paused && element.currentTime > 0) {
                    return true;
                }
            }
            return false;
        }
        if (watch.kind === 'image') {
            // A picture matching the query is loaded, and it is not one that was there when the action was armed.
            return findAll(watch).some(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
                && !state.imagesAtArm.has(image.currentSrc) && (watch.srcIncludes === undefined || image.currentSrc.includes(watch.srcIncludes)));
        }
        return false;
    };

    /** How an element sits on screen, as text: two readings that are equal mean it has not moved or faded. */
    const poseOf = (query) => {
        const element = find({ ...query, shown: false });
        if (!element) {
            return null;
        }
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return `${box.left.toFixed(1)},${box.top.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)},${Number(style.opacity).toFixed(3)},${style.visibility},${style.transform}`;
    };

    /** The time stamp of the input an armed action waits for, once it has come. */
    const inputOf = (armed) => {
        const wanted = armed.spec.startOn ?? ['click', 'keydown'];
        return inputs.slice(armed.inputsFrom).find(entry => wanted.includes(entry.type))?.at ?? null;
    };

    const onFrame = (frameAt) => {
        if (!action || action.spec.bare) {
            frameLoop = 0;
            return;
        }
        const began = performance.now();
        action.frames.push(frameAt);
        action.t0 ??= inputOf(action);
        if (action.t0 !== null) {
            const waiting = Object.keys(action.spec.watch ?? {}).some(name => !(name in action.firsts));
            // `gate` is one condition several watches stand behind (those marked `gated`). It is looked
            // at once a frame at most, and while it does not hold those watches are not looked at.
            let gateOpen = null;
            const gate = () => (gateOpen ??= !action.spec.gate || holds(action.spec.gate, action));
            for (const [name, watch] of Object.entries(action.spec.watch ?? {})) {
                // `after` names another watch: this one is only looked at once that one has held.
                if (name in action.firsts || (watch.after && !(watch.after in action.firsts)) || (watch.gated && !gate())) {
                    continue;
                }
                if (holds(watch, action)) {
                    action.firsts[name] = frameAt;
                    // Where the playing song's own clock stands in this frame (seconds; null when nothing plays):
                    // what is due at a time of the song is judged by it, not by the page's clock.
                    // (The app has two audio elements; were both running, the song that has just started is the one with the lower clock.)
                    const clocks = [...document.querySelectorAll('audio')].filter(element => !element.paused && element.currentTime > 0).map(element => element.currentTime);
                    action.songClockAt[name] = clocks.length ? Math.min(...clocks) : null;
                }
            }
            if (action.spec.track) {
                const pose = poseOf(action.spec.track);
                if (pose !== action.track.pose) {
                    action.track.pose = pose;
                    action.track.changes += 1;
                    action.track.firstChangeAt ??= frameAt;
                    action.track.lastChangeAt = frameAt;
                    if (pose !== null && action.track.appearedAt === null) {
                        action.track.appearedAt = frameAt;
                    }
                }
            }
            // What this look took of the main thread: over all the frames since the input, and apart
            // for the frames in which something watched for had not held yet (the looks that are
            // inside the times that are measured).
            const took = performance.now() - began;
            const { look } = action;
            look.frames += 1;
            look.ms += took;
            look.worstMs = Math.max(look.worstMs, took);
            if (waiting) {
                look.waitingFrames += 1;
                look.waitingMs += took;
            }
        }
        frameLoop = requestAnimationFrame(onFrame);
    };

    /**
     * Arms a measurement. The next real click or key press (`startOn`) starts its clock; from then
     * on every frame is timed, each `watch` is noted the first frame it holds, and `track` (one
     * element) is watched for when it stops moving and fading.
     * With `bare` nothing is looked at and no frame is asked for: only what is always on (the media
     * and input events, the browser's long tasks) is in the record. It is how the cost of the looks
     * themselves is measured: the same action with them and without.
     */
    const begin = (spec) => {
        const imagesAtArm = new Set([...document.images].map(image => image.currentSrc));
        action = {
            spec,
            armedAt: now(),
            t0: null,
            inputsFrom: inputs.length,
            mediaFrom: media.length,
            frames: [],
            firsts: {},
            songClockAt: {},
            track: { pose: spec.track ? poseOf(spec.track) : null, changes: 0, firstChangeAt: null, lastChangeAt: null, appearedAt: null },
            look: { frames: 0, ms: 0, worstMs: 0, waitingFrames: 0, waitingMs: 0 },
            imagesAtArm,
        };
        if (!spec.bare && !frameLoop) {
            frameLoop = requestAnimationFrame(onFrame);
        }
        return true;
    };

    const end = () => {
        if (!action) {
            return null;
        }
        const finished = action;
        action = null;
        // A bare action has no frame to find its input in: it is looked up now.
        finished.t0 ??= inputOf(finished);
        const t0 = finished.t0;
        const since = value => (t0 === null || value === null || value === undefined ? null : round(value - t0));
        const from = t0 ?? finished.armedAt;
        return {
            armedAt: round(finished.armedAt),
            t0: t0 === null ? null : round(t0),
            endedAt: round(now()),
            inputs: inputs.slice(finished.inputsFrom).map(entry => ({ type: entry.type, at: since(entry.at), handledAt: since(entry.handledAt), key: entry.key })),
            firsts: Object.fromEntries(Object.keys(finished.spec.watch ?? {}).map(name => [name, since(finished.firsts[name] ?? null)])),
            songClockAt: finished.songClockAt,
            // The recorder's own looks since the input, in milliseconds of the main thread.
            look: { frames: finished.look.frames, ms: round(finished.look.ms), worstMs: Math.round(finished.look.worstMs * 100) / 100, waitingFrames: finished.look.waitingFrames, waitingMs: round(finished.look.waitingMs) },
            track: { appearedAt: since(finished.track.appearedAt), firstChangeAt: since(finished.track.firstChangeAt), lastChangeAt: since(finished.track.lastChangeAt), changes: finished.track.changes },
            // Frame times before the input too (negative), so the frame rate just before it can be read.
            frames: finished.frames.map(frameAt => round(frameAt - from)),
            media: media.slice(finished.mediaFrom).map(entry => ({ ...entry, at: since(entry.at) })),
            longTasks: longTasks.filter(task => task.start + task.duration >= from).map(task => ({ start: round(task.start - from), duration: round(task.duration) })),
            longFrames: longFrames.filter(frame => frame.start + frame.duration >= from).map(frame => ({ start: round(frame.start - from), duration: round(frame.duration), blocking: round(frame.blocking), scripts: frame.scripts.map(script => ({ name: script.name, duration: round(script.duration), forcedStyleAndLayout: round(script.forcedStyleAndLayout) })) })),
            eventTimings: eventTimings.filter(entry => entry.start >= from - 1).map(entry => ({ name: entry.name, start: round(entry.start - from), inputDelay: round(entry.processingStart - entry.start), processing: round(entry.processingEnd - entry.processingStart), toNextPaint: round(entry.duration) })),
        };
    };

    /** The gaps between animation frames over some milliseconds, with nothing else asked of the page. */
    const frameGaps = forMs => new Promise((resolve) => {
        const gaps = [];
        let last = 0;
        const startedAt = now();
        const tick = (at) => {
            if (last) {
                gaps.push(round(at - last));
            }
            last = at;
            if (at - startedAt < forMs) {
                requestAnimationFrame(tick);
            } else {
                resolve(gaps);
            }
        };
        requestAnimationFrame(tick);
    });

    contextBridge.exposeInMainWorld('__perfApp', {
        startup,
        /** Whether the first page is usable yet: the short answer, for the runner to ask while the app starts (`startup` copies every list it holds). */
        usable: counted(() => ({ ...usable })),
        begin,
        end,
        frameGaps,
        /** The centre of the element a query means, or null. */
        locate: (query) => {
            const element = find(query);
            return element ? describe(element) : null;
        },
        /** Up to `limit` elements a query means, described: for a look at what a page offers. */
        list: (query, limit = 40) => findAll(query).slice(0, limit).map(describe),
        count: query => findAll(query).length,
        /** The pieces of text inside `scope` that match a pattern, in document order. */
        texts: (scope, pattern, limit = 40) => {
            const found = [];
            const test = new RegExp(pattern);
            let lastParent = null;
            for (const element of document.querySelectorAll(scope)) {
                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node && found.length < limit; node = walker.nextNode()) {
                    const text = node.nodeValue.trim();
                    if (!text) {
                        continue;
                    }
                    // React writes "24 Tracks • All Songs" as several pieces; the element that holds them reads as one.
                    const whole = wholeText(node.parentElement);
                    if (test.test(text)) {
                        found.push(text);
                    } else if (node.parentElement !== lastParent && test.test(whole)) {
                        found.push(whole);
                    }
                    lastParent = node.parentElement;
                }
            }
            return found;
        },
        hash: () => location.hash,
        /** Whether a watch holds right now (the kinds that need no armed action: present, gone, style, pictures, text, all). */
        holds: watch => holds(watch, { t0: null, mediaFrom: 0, imagesAtArm: new Set() }),
        /** Pictures inside the window: how many, and how many have not finished loading. */
        pictures: () => picturesPending(),
        /** What an <audio> element is doing now. */
        audio: () => [...document.querySelectorAll('audio')].map(element => ({ src: shortUrl(element.currentSrc), paused: element.paused, currentTime: round(element.currentTime * 1000) / 1000, duration: element.duration || 0, readyState: element.readyState, muted: element.muted, volume: element.volume })),
        counts: () => ({
            elements: document.getElementsByTagName('*').length,
            images: document.images.length,
            canvases: document.getElementsByTagName('canvas').length,
            audio: document.getElementsByTagName('audio').length,
            video: document.getElementsByTagName('video').length,
        }),
        info: () => ({ url: location.href.slice(-120), title: document.title, width: innerWidth, height: innerHeight, scale: devicePixelRatio, visibility: document.visibilityState, focused: document.hasFocus() }),
    });
})();
