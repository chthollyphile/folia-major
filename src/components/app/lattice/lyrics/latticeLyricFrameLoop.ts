// src/components/app/lattice/lyrics/latticeLyricFrameLoop.ts
// One demand-driven loop; paused and hidden cards never keep a background ticker alive.
export function createLatticeLyricFrameLoop(draw: (delta: number) => boolean,
    request: (callback: FrameRequestCallback) => number = requestAnimationFrame,
    cancel: (id: number) => void = cancelAnimationFrame) {
    let frame: number | null = null, previous = 0, visible = true, destroyed = false;
    const tick: FrameRequestCallback = time => {
        frame = null;
        if (destroyed || !visible) return;
        const delta = previous ? Math.min(0.05, (time - previous) / 1000) : 1 / 60;
        previous = time;
        if (draw(delta)) wake();
    };
    const wake = () => {
        if (!destroyed && visible && frame === null) frame = request(tick);
    };
    const stop = () => { if (frame !== null) cancel(frame); frame = null; previous = 0; };
    return { wake,
        setVisible(value: boolean) { visible = value; if (value) wake(); else stop(); },
        destroy() { destroyed = true; stop(); },
    };
}
