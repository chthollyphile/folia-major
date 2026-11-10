// dev/perf/clock.js
// Injected by dev/perf/shots.mjs before any script of the page runs (never by the measuring runner).
// It takes the page off real time, so that the same steps give the same picture:
//
//   - Math.random gives the same numbers on every load (a seeded generator);
//   - one clock for performance.now(), Date.now(), `new Date()`, `Date()`, the time handed to
//     requestAnimationFrame callbacks and document.timeline.currentTime. It stands still until the
//     page calls __perfClock.run(steps) and then moves exactly 1/60 s per step;
//   - requestAnimationFrame callbacks run once per step and never in between; one that is
//     cancelled before its turn in the step does not run;
//   - setTimeout, setInterval, setImmediate and requestIdleCallback are kept in a list here and run
//     when the stepped clock reaches them. A timer with no delay runs without a step, at the next
//     frame of the screen. React schedules its rendering through setImmediate when there is one,
//     so its work is in that list too;
//   - CSS animations, CSS transitions and Web Animations are paused the moment they appear and
//     moved 1/60 s per step by hand (their currentTime). One that reaches its end is finished, so
//     its events fire;
//   - what the page loads is counted: fetch and the reading of a response, XMLHttpRequest, image
//     elements, createImageBitmap, image.decode(), fonts, FileReader, canvas.toBlob, IndexedDB,
//     style sheets and scripts added to the page, and messages sent to a worker that have not been
//     answered. While one is under way no timer runs and no step is taken, so a load that began at
//     one point has always ended before anything else of the page goes on, however long it took.
//
// All of this runs once per frame of the screen, inside that frame's own callback, so the page is
// laid out and painted after every turn and never in the middle of one. A step is taken only in a
// frame that found the page still (no timer to run, nothing loading, no animation just begun): what
// a step sets off has played out before the next. How fast the screen refreshes and how long a
// frame takes change how long a capture takes, not what is in the pictures.
//
// Not taken off real time: videos, animated images, smooth scrolling, what a worker does without
// being asked by a message, loads that begin without any of the calls above (a picture named in a
// style sheet, a dynamic import: shots.mjs waits for the network to be quiet at the points where
// those begin), and an animation paused through CSS (animation-play-state): it stays paused here.
(() => {
    let seed = 0x2f6e2b1;
    /** How often the page has asked for a random number: two captures that differ here have not run the same code. */
    let randoms = 0;
    Math.random = () => {
        randoms += 1;
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const FRAME_MS = 1000 / 60;
    const EPOCH_MS = 1767225600000;
    /**
     * After this many frames in a row in which only timers without delay ran (a loop that sets
     * itself again and again), such timers no longer hold the next step back.
     */
    const CHAIN_LIMIT = 40;
    /** Real milliseconds a load may take before the capture of the scenario fails. */
    const LOAD_LIMIT_MS = 20_000;
    /** Real milliseconds a worker may leave a message unanswered before it stops being waited for. */
    const WORKER_LIMIT_MS = 3000;

    const real = {
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        setTimeout: window.setTimeout.bind(window),
        now: performance.now.bind(performance),
    };
    let steps = 0;
    let now = 0;
    let inStep = false;

    /** An error of the page's own code goes where an uncaught one goes: the runner reads it there. */
    const report = (error) => {
        real.setTimeout(() => { throw error; }, 0);
    };
    const call = (callback, args) => {
        try {
            callback.apply(window, args);
        } catch (error) {
            report(error);
        }
    };

    // -----------------------------------------------------------------------------------------
    // The clock
    // -----------------------------------------------------------------------------------------

    performance.now = () => now;
    const NativeDate = Date;
    // A proxy, so that `Date()` without `new`, `new Date()`, `Date.now()`, `instanceof Date` and the
    // rest of Date all work as they do on the real one.
    window.Date = new Proxy(NativeDate, {
        construct: (target, parts, newTarget) => Reflect.construct(target, parts.length === 0 ? [EPOCH_MS + now] : parts, newTarget),
        apply: target => new target(EPOCH_MS + now).toString(),
        get: (target, name) => (name === 'now' ? () => EPOCH_MS + now : Reflect.get(target, name)),
    });
    try {
        Object.defineProperty(document.timeline, 'currentTime', { configurable: true, get: () => now });
    } catch {
        // Not reachable in this engine: animations are held by hand below either way.
    }

    // -----------------------------------------------------------------------------------------
    // Timers and animation frames
    // -----------------------------------------------------------------------------------------

    let nextTimer = 1;
    let nextOrder = 1;
    const timers = new Map();
    const addTimer = (callback, delay, args, repeats) => {
        const id = nextTimer;
        nextTimer += 1;
        // A repeating timer is held to 4 ms at least, as a browser holds it.
        const wait = Math.max(repeats ? 4 : 0, Number(delay) || 0);
        timers.set(id, { id, callback, args, every: repeats ? wait : 0, due: now + wait, order: nextOrder });
        nextOrder += 1;
        return id;
    };
    window.setTimeout = (callback, delay, ...args) => addTimer(callback, delay, args, false);
    window.setInterval = (callback, delay, ...args) => addTimer(callback, delay, args, true);
    window.setImmediate = (callback, ...args) => addTimer(callback, 0, args, false);
    window.requestIdleCallback = callback => addTimer(() => callback({ didTimeout: false, timeRemaining: () => 8 }), 0, [], false);
    const clearTimer = (id) => { timers.delete(id); };
    window.clearTimeout = clearTimer;
    window.clearInterval = clearTimer;
    window.clearImmediate = clearTimer;
    window.cancelIdleCallback = clearTimer;

    /**
     * Lets the promise callbacks that are waiting run before the next callback, as a browser does
     * after every callback it calls. Everything here stays inside the one frame callback of the
     * screen that began it, so the page is never painted half-way through a turn.
     */
    const hop = async () => {
        await null;
        await null;
    };

    /** Runs the timers the clock has reached, earliest first; the ones they set wait for the next call. Returns how many ran. */
    const runDue = async () => {
        const due = [];
        timers.forEach((timer) => {
            if (timer.due <= now) {
                due.push(timer);
            }
        });
        due.sort((left, right) => left.due - right.due || left.order - right.order);
        for (const timer of due) {
            if (timers.get(timer.id) === timer) {
                if (timer.every) {
                    timer.due += timer.every;
                    timer.order = nextOrder;
                    nextOrder += 1;
                } else {
                    timers.delete(timer.id);
                }
                if (typeof timer.callback === 'function') {
                    call(timer.callback, timer.args);
                    await hop();
                }
            }
        }
        return due.length;
    };

    let nextFrame = 1;
    const frames = new Map();
    window.requestAnimationFrame = (callback) => {
        const handle = nextFrame;
        nextFrame += 1;
        frames.set(handle, callback);
        return handle;
    };
    window.cancelAnimationFrame = (handle) => {
        frames.delete(handle);
    };

    // -----------------------------------------------------------------------------------------
    // CSS animations, CSS transitions, Web Animations
    // -----------------------------------------------------------------------------------------

    const animationProto = window.Animation.prototype;
    const nativePlay = animationProto.play;
    const nativePause = animationProto.pause;
    const nativeReverse = animationProto.reverse;
    const nativeFinish = animationProto.finish;
    const nativeAnimate = Element.prototype.animate;
    const startTime = Object.getOwnPropertyDescriptor(animationProto, 'startTime');
    /** Every animation taken off real time: whether the page itself paused it, and whether the next step leaves it where it is. */
    const held = new Map();
    const stepped = animation => animation.timeline === document.timeline;

    /**
     * The record of an animation that is taken off real time now. One that begins between two
     * steps begins with the next frame in a browser, so the next step leaves it at its start; one
     * that begins inside a step is moved on by the step after it.
     */
    const take = (animation) => {
        let record = held.get(animation);
        if (!record) {
            record = { stopped: false, skip: inStep ? 0 : 1 };
            held.set(animation, record);
        }
        return record;
    };
    const pauseQuietly = (animation) => {
        try {
            nativePause.call(animation);
            return true;
        } catch {
            return false;
        }
    };

    animationProto.play = function play() {
        nativePlay.call(this);
        if (stepped(this)) {
            take(this).stopped = false;
            pauseQuietly(this);
        }
    };
    animationProto.reverse = function reverse() {
        nativeReverse.call(this);
        if (stepped(this)) {
            take(this).stopped = false;
            pauseQuietly(this);
        }
    };
    animationProto.pause = function pause() {
        nativePause.call(this);
        if (stepped(this)) {
            take(this).stopped = true;
        }
    };
    Object.defineProperty(animationProto, 'startTime', {
        configurable: true,
        enumerable: true,
        get() {
            return startTime.get.call(this);
        },
        // "It began at this time of the page's clock" is, on a clock that is stepped, "it is this far in".
        set(value) {
            if (value === null || !stepped(this)) {
                startTime.set.call(this, value);
                return;
            }
            take(this).stopped = false;
            if (pauseQuietly(this)) {
                this.currentTime = (now - Number(value)) * this.playbackRate;
            }
        },
    });
    Element.prototype.animate = function animate(...args) {
        const animation = nativeAnimate.apply(this, args);
        if (animation.playState === 'running' && stepped(animation)) {
            take(animation);
            pauseQuietly(animation);
        }
        return animation;
    };

    /**
     * Takes every animation the document has started by itself (a style change) off real time.
     * Asking for the list makes the document work out its styles, so a transition a step has caused
     * exists by the end of that step. One that has already run on real time for a moment is put
     * back to its start. Returns how many it found.
     */
    const holdNew = () => {
        let found = 0;
        document.getAnimations().forEach((animation) => {
            if (held.has(animation) || !stepped(animation)) {
                return;
            }
            const state = animation.playState;
            if (state === 'paused') {
                held.set(animation, { stopped: true, skip: 0 });
                return;
            }
            if (state !== 'running') {
                return;
            }
            const pending = animation.pending;
            if (!pauseQuietly(animation)) {
                return;
            }
            if (!pending && animation.playbackRate > 0) {
                animation.currentTime = 0;
            }
            take(animation);
            found += 1;
        });
        return found;
    };

    /** Moves every held animation one step on; one that reaches its end is finished, which fires its events. */
    const advanceAnimations = () => {
        held.forEach((record, animation) => {
            const state = animation.playState;
            if (state === 'running') {
                // Started again past the calls above.
                const at = animation.currentTime;
                if (pauseQuietly(animation) && at !== null) {
                    animation.currentTime = at;
                }
            } else if (state !== 'paused') {
                held.delete(animation);
                return;
            }
            if (record.stopped) {
                return;
            }
            if (record.skip > 0) {
                record.skip -= 1;
                return;
            }
            const effect = animation.effect;
            if (effect && effect.target && !effect.target.isConnected) {
                held.delete(animation);
                return;
            }
            const rate = animation.playbackRate;
            const next = (animation.currentTime ?? 0) + FRAME_MS * rate;
            const end = effect ? effect.getComputedTiming().endTime : 0;
            if ((rate > 0 && next >= end) || (rate < 0 && next <= 0)) {
                held.delete(animation);
                try {
                    nativeFinish.call(animation);
                } catch {
                    // It cannot be finished (no end in that direction): it stays where it is.
                }
            } else if (rate !== 0) {
                animation.currentTime = next;
            }
        });
    };

    // -----------------------------------------------------------------------------------------
    // Loads under way
    // -----------------------------------------------------------------------------------------

    let loads = 0;
    /** The same promise to the caller, counted as a load until it settles. */
    const counted = promise => new Promise((resolve, reject) => {
        loads += 1;
        promise.then((value) => {
            loads -= 1;
            resolve(value);
        }, (error) => {
            loads -= 1;
            reject(error);
        });
    });
    /** Counts a load from now until the first of `events` on `target`. */
    const countedUntil = (target, events) => {
        loads += 1;
        let open = true;
        const done = () => {
            if (open) {
                open = false;
                loads -= 1;
            }
        };
        events.forEach(name => target.addEventListener(name, done, { once: true }));
    };
    const countCalls = (holder, names) => names.forEach((name) => {
        const native = holder?.[name];
        if (typeof native === 'function') {
            holder[name] = function countedCall(...args) {
                return counted(native.apply(this, args));
            };
        }
    });

    countCalls(window, ['fetch', 'createImageBitmap']);
    countCalls(window.Response?.prototype, ['arrayBuffer', 'blob', 'json', 'text', 'formData', 'bytes']);
    countCalls(window.Blob?.prototype, ['arrayBuffer', 'text', 'bytes']);
    countCalls(window.HTMLImageElement.prototype, ['decode']);
    countCalls(window.FontFace?.prototype, ['load']);
    countCalls(window.OffscreenCanvas?.prototype, ['convertToBlob']);

    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function send(...args) {
        countedUntil(this, ['loadend']);
        return nativeSend.apply(this, args);
    };
    ['readAsArrayBuffer', 'readAsDataURL', 'readAsText', 'readAsBinaryString'].forEach((name) => {
        const native = FileReader.prototype[name];
        FileReader.prototype[name] = function read(...args) {
            countedUntil(this, ['loadend']);
            return native.apply(this, args);
        };
    });
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback, ...args) {
        loads += 1;
        return nativeToBlob.call(this, (blob) => {
            loads -= 1;
            callback(blob);
        }, ...args);
    };
    if (window.IDBFactory) {
        ['open', 'deleteDatabase'].forEach((name) => {
            const native = IDBFactory.prototype[name];
            IDBFactory.prototype[name] = function request(...args) {
                const made = native.apply(this, args);
                countedUntil(made, ['success', 'error']);
                return made;
            };
        });
        const nativeTransaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function transaction(...args) {
            const made = nativeTransaction.apply(this, args);
            countedUntil(made, ['complete', 'abort']);
            return made;
        };
    }

    // An image element counts from the moment it is given an address until it has it or has failed.
    const imagesLoading = new Set();
    const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: true,
        get() {
            return imageSrc.get.call(this);
        },
        set(value) {
            imagesLoading.add(this);
            imageSrc.set.call(this, value);
        },
    });

    // A style sheet or a script the page adds to itself counts until it has loaded.
    new MutationObserver((records) => {
        records.forEach(record => record.addedNodes.forEach((node) => {
            const isSheet = node instanceof HTMLLinkElement && (node.rel === 'stylesheet' || node.rel === 'modulepreload') && node.href;
            const isScript = node instanceof HTMLScriptElement && node.src;
            if (isSheet || isScript) {
                countedUntil(node, ['load', 'error']);
            }
        }));
    }).observe(document, { childList: true, subtree: true });

    // A message to a worker counts until the worker has sent one back. A worker that has just been
    // made counts too, until it says something by itself or is asked something: some report on
    // their own once they are up (Pixi asks one whether it can decode pictures), and the page goes
    // on from that answer.
    const workers = new Set();
    const NativeWorker = window.Worker;
    if (NativeWorker) {
        window.Worker = class extends NativeWorker {
            constructor(...args) {
                super(...args);
                const state = { owed: 1, unasked: true, since: real.now(), name: String(args[0]).slice(0, 80) };
                workers.add(state);
                this.addEventListener('message', () => {
                    state.owed = Math.max(0, state.owed - 1);
                    state.unasked = false;
                    state.since = real.now();
                });
                this.addEventListener('error', () => {
                    state.owed = 0;
                });
                this.perfState = state;
            }

            postMessage(...args) {
                if (this.perfState.unasked) {
                    this.perfState.unasked = false;
                    this.perfState.owed = 0;
                }
                if (this.perfState.owed === 0) {
                    this.perfState.since = real.now();
                }
                this.perfState.owed += 1;
                return super.postMessage(...args);
            }

            terminate() {
                this.perfState.owed = 0;
                workers.delete(this.perfState);
                return super.terminate();
            }
        };
    }

    /** What the page is still loading, in words; an empty string when nothing. */
    const loading = () => {
        if (loads > 0) {
            return `${loads} load${loads > 1 ? 's' : ''} (fetch, bitmap, decode, storage, sheet or script)`;
        }
        if (document.fonts.status === 'loading') {
            return 'a font';
        }
        for (const image of document.images) {
            if (!image.complete && image.loading !== 'lazy') {
                return `the picture ${image.currentSrc || image.src}`.slice(0, 160);
            }
        }
        for (const image of imagesLoading) {
            if (image.complete) {
                imagesLoading.delete(image);
            } else {
                return `the picture ${image.src}`.slice(0, 160);
            }
        }
        for (const state of workers) {
            if (state.owed > 0) {
                if (real.now() - state.since > WORKER_LIMIT_MS) {
                    console.warn(`[perf clock] a worker left ${state.owed} message(s) unanswered for ${WORKER_LIMIT_MS} ms and is no longer waited for: ${state.name}`);
                    state.owed = 0;
                } else {
                    return `an answer from the worker ${state.name}`;
                }
            }
        }
        return '';
    };

    // -----------------------------------------------------------------------------------------
    // Steps
    // -----------------------------------------------------------------------------------------

    /** One step: the clock moves 1/60 s, the animations with it, then the timers it has reached, then the frame callbacks. */
    const step = async () => {
        inStep = true;
        steps += 1;
        now = steps * FRAME_MS;
        advanceAnimations();
        await runDue();
        // As a browser runs them: the callbacks asked for before the step, in order, and one that an
        // earlier callback of this step has cancelled is not run. Those asked for during the step
        // wait for the next.
        for (const handle of [...frames.keys()]) {
            const callback = frames.get(handle);
            if (callback === undefined) {
                continue;
            }
            frames.delete(handle);
            call(callback, [now]);
            await hop();
        }
        holdNew();
        inStep = false;
    };

    let stepsLeft = 0;
    /** The run under way: resolves once its last step has been taken and the page is still again. */
    let running = null;
    /** A wait for the page to be still for some frames of the screen in a row. */
    let resting = null;
    let failure = null;
    let calm = 0;
    let chain = 0;
    let loadingSince = 0;

    const fail = (message) => {
        failure = new Error(`[perf clock] ${message}`);
        [running, resting].forEach(waiting => waiting?.reject(failure));
        running = null;
        resting = null;
        stepsLeft = 0;
    };

    /**
     * The page's turn, once per frame of the screen and all of it before that frame is painted:
     * what the document started by itself since the last frame is held; then, unless something
     * is loading, the timers that need no time to pass are run (React's rendering among them).
     * While something loads nothing of the page's own runs at all, no timer and no step: a load
     * takes real time, and whatever went on beside it would have got further in one capture than
     * in another (Sonnet builds a scene per timer while its icons decode: which scenes had the
     * icons depended on how fast the decoding was). A step is taken only in a turn that found the
     * page still: nothing to hold, nothing to run, nothing loading. So everything a step set off
     * has played out, and has been laid out and painted, before the next one, however many frames
     * of the screen that takes.
     */
    const turn = async () => {
        const started = holdNew();
        const waitingFor = loading();
        if (waitingFor) {
            loadingSince ||= real.now();
            if (real.now() - loadingSince > LOAD_LIMIT_MS) {
                fail(`the page did not come to rest in ${LOAD_LIMIT_MS / 1000} s: it waits for ${waitingFor}`);
            }
            calm = 0;
            return;
        }
        loadingSince = 0;
        const ran = await runDue();
        chain = ran > 0 ? chain + 1 : 0;
        const still = started === 0 && (ran === 0 || chain > CHAIN_LIMIT) && !loading();
        calm = still ? calm + 1 : 0;
        if (still && stepsLeft > 0) {
            stepsLeft -= 1;
            calm = 0;
            await step();
            return;
        }
        if (still && running) {
            running.resolve();
            running = null;
        }
        if (resting && calm >= resting.frames) {
            resting.resolve();
            resting = null;
        }
    };
    const pump = () => {
        real.requestAnimationFrame(pump);
        if (!failure) {
            turn().catch(report);
        }
    };
    real.requestAnimationFrame(pump);

    window.__perfClock = {
        frameMs: FRAME_MS,
        /** Takes this many steps; resolves when the last one is done and the page is still. */
        run: count => new Promise((resolve, reject) => {
            if (failure) {
                reject(failure);
            } else if (running) {
                reject(new Error('[perf clock] a run is already under way'));
            } else if (count <= 0) {
                resolve();
            } else {
                stepsLeft = count;
                running = { resolve, reject };
            }
        }),
        /** Resolves when the page has been still for `frameCount` frames of the screen in a row. */
        rest: (frameCount = 3) => new Promise((resolve, reject) => {
            if (failure) {
                reject(failure);
            } else {
                calm = 0;
                resting = { frames: frameCount, resolve, reject };
            }
        }),
        /** Real time, for the rig's own waits. */
        real,
        /** Where the page stands: shots.mjs keeps this beside every picture, so that two captures can be told apart by more than their pixels. */
        state: () => ({ steps, randoms, timers: timers.size, animations: held.size, loads, loading: loading() }),
    };
})();
