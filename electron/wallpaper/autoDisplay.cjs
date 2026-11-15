// Resolves one wallpaper display from visible work windows, with delayed and serialized changes.
const AUTO_DISPLAY_KEY = 'WALLPAPER_AUTO_AVOID_WINDOWS';

function coversWorkspace(window, area, tolerance = 8) {
    return !window.ignored && window.width >= area.width - tolerance * 2
        && window.height >= area.height - tolerance * 2
        && window.x <= area.x + tolerance && window.y <= area.y + tolerance
        && window.x + window.width >= area.x + area.width - tolerance
        && window.y + window.height >= area.y + area.height - tolerance;
}

function chooseAutoDisplay(displays, primary, windows, primaryScreenBounds, primaryWorkArea = primaryScreenBounds) {
    if (!primary || !displays.length) return null;
    const centerX = primary.bounds.x + primary.bounds.width / 2;
    const centerY = primary.bounds.y + primary.bounds.height / 2;
    const distance = display => (display.bounds.x + display.bounds.width / 2 - centerX) ** 2
        + (display.bounds.y + display.bounds.height / 2 - centerY) ** 2;
    const secondary = displays.filter(display => display.id !== primary.id)
        .sort((a, b) => distance(a) - distance(b))[0];
    if (!secondary) return primary;
    const occupied = windows.some(window => window.maximized
        ? coversWorkspace(window, primaryWorkArea)
        : coversWorkspace(window, primaryScreenBounds, 1));
    return occupied ? secondary : primary;
}

function createAutoDisplayController({ getSnapshot, move, isActive, now = Date.now,
    setIntervalFn = setInterval, clearIntervalFn = clearInterval, onError = console.warn,
    onCurrentTarget = () => {},
    intervalMs = 1000, settleMs = 1500 }) {
    let timer = null;
    let candidate = null;
    let since = 0;
    let busy = false;
    let generation = 0;
    let reportedError = false;

    async function tick() {
        if (busy) return;
        if (!isActive()) { candidate = null; return; }
        busy = true;
        const started = generation;
        try {
            const { displays, primary, windows, primaryScreenBounds, primaryWorkArea, current } = getSnapshot();
            const target = chooseAutoDisplay(displays, primary, windows, primaryScreenBounds, primaryWorkArea);
            if (!target) { candidate = null; return; }
            const key = JSON.stringify([target.id, target.bounds]);
            if (key !== candidate) { candidate = key; since = now(); return; }
            if (now() - since < settleMs || !isActive() || started !== generation) return;
            // Display-metrics events already reapply geometry; use the same identity rule as Folia's mover.
            if (current && current.id === target.id) { onCurrentTarget(target); return; }
            await move(target);
            reportedError = false;
        } catch (error) {
            candidate = null;
            if (!reportedError) onError('[AutoDisplay] display detection or switching failed', error);
            reportedError = true;
        } finally { busy = false; }
    }

    return {
        tick,
        start() {
            if (timer !== null) return;
            timer = setIntervalFn(() => { void tick(); }, intervalMs);
            timer?.unref?.();
        },
        reset() { generation++; candidate = null; },
        stop() {
            generation++;
            candidate = null;
            if (timer !== null) clearIntervalFn(timer);
            timer = null;
        },
    };
}

module.exports = { AUTO_DISPLAY_KEY, chooseAutoDisplay, createAutoDisplayController, coversWorkspace };
