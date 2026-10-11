// src/components/visualizer/sonnet/sonnetAnimatedGraphics.ts
// Records Graphics commands so strokes/fills can grow with the shared stagger
// schedule during playback instead of appearing fully drawn at scene build.
type PixiModule = typeof import('pixi.js');

// Whether replaying `cmd` starts a fresh polygon: fills always lead with moveTo(0, 0), strokes only when
// their recorded path does. Anything else continues from the previous command's end point.
const opensOwnPath = (cmd: any) => {
    if (cmd.type === 'fill') return true;
    if (cmd.length <= 0) return false;
    const first = cmd.path.find((p: any) => p.type !== 'rect_hint');
    return first?.type === 'moveTo';
};

export class AnimatedGraphics {
    public display: import('pixi.js').Graphics;

    private commands: any[] = [];
    private currentPath: any[] = [];
    private currentLength = 0;
    private lastX = 0;
    private lastY = 0;
    private staggerScheduled = false;
    // What the Graphics currently shows: the clamped progress and how many commands it drew.
    private drawnProgress = Number.NaN;
    private drawnCommandCount = -1;

    constructor(pixi: PixiModule) {
        this.display = new pixi.Graphics();
    }

    get rotation() { return this.display.rotation; }
    set rotation(v: number) { this.display.rotation = v; }

    get mask() { return this.display.mask; }
    set mask(v: any) { this.display.mask = v; }

    moveTo(x: number, y: number) {
        this.currentPath.push({ type: 'moveTo', x, y });
        this.lastX = x;
        this.lastY = y;
        return this;
    }

    lineTo(x: number, y: number) {
        const len = Math.hypot(x - this.lastX, y - this.lastY);
        this.currentPath.push({ type: 'lineTo', x, y, len, lastX: this.lastX, lastY: this.lastY });
        this.currentLength += len;
        this.lastX = x;
        this.lastY = y;
        return this;
    }

    quadraticCurveTo(cx: number, cy: number, tx: number, ty: number) {
        const len = Math.hypot(cx - this.lastX, cy - this.lastY) + Math.hypot(tx - cx, ty - cy);
        this.currentPath.push({ type: 'quadraticCurveTo', cx, cy, tx, ty, len, lastX: this.lastX, lastY: this.lastY });
        this.currentLength += len;
        this.lastX = tx;
        this.lastY = ty;
        return this;
    }

    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, tx: number, ty: number) {
        const len = Math.hypot(c1x - this.lastX, c1y - this.lastY) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(tx - c2x, ty - c2y);
        this.currentPath.push({ type: 'bezierCurveTo', c1x, c1y, c2x, c2y, tx, ty, len, lastX: this.lastX, lastY: this.lastY });
        this.currentLength += len;
        this.lastX = tx;
        this.lastY = ty;
        return this;
    }

    arc(cx: number, cy: number, r: number, start: number, end: number, anticlockwise = false) {
        let diff = end - start;
        if (anticlockwise && diff > 0) diff -= Math.PI * 2;
        else if (!anticlockwise && diff < 0) diff += Math.PI * 2;
        const len = Math.abs(diff) * r;
        this.currentPath.push({ type: 'arc', cx, cy, r, start, end, anticlockwise, len, diff });
        this.currentLength += len;
        this.lastX = cx + Math.cos(end) * r;
        this.lastY = cy + Math.sin(end) * r;
        return this;
    }

    circle(x: number, y: number, r: number) {
        // Randomize the start angle and direction to give organic variance (avoiding uniform "drawn from the right" look)
        const start = Math.random() * Math.PI * 2;
        const anticlockwise = Math.random() > 0.5;
        const diff = anticlockwise ? -Math.PI * 2 : Math.PI * 2;
        const len = Math.PI * 2 * r;
        const startX = x + Math.cos(start) * r;
        const startY = y + Math.sin(start) * r;

        this.moveTo(startX, startY);
        this.currentPath.push({ type: 'arc', cx: x, cy: y, r, start, end: start + diff, anticlockwise, len, diff });
        this.currentLength += len;
        this.lastX = x + Math.cos(start + diff) * r;
        this.lastY = y + Math.sin(start + diff) * r;
        return this;
    }

    rect(x: number, y: number, w: number, h: number) {
        this.currentPath.push({ type: 'rect_hint', x, y, w, h });
        this.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).lineTo(x, y);
        return this;
    }

    stroke(options: any) {
        if (this.currentPath.length > 0) {
            this.commands.push({ type: 'stroke', path: [...this.currentPath], length: this.currentLength, options });
            this.currentPath = [];
            this.currentLength = 0;
        }
        return this;
    }

    fill(options: any) {
        if (this.currentPath.length > 0) {
            this.commands.push({ type: 'fill', path: [...this.currentPath], length: this.currentLength, options });
            this.currentPath = [];
            this.currentLength = 0;
        }
        return this;
    }

    // Assigns each stroke/fill its own deterministic time window so growth layers
    // across the whole shot instead of everything finishing together. Golden-ratio
    // slots spread the start times evenly (no aliasing clusters), per-command jitter
    // varies the durations, and every span is clamped so all commands complete
    // exactly at progress 1. Pure function of command order — seek-safe.
    private scheduleStagger() {
        const GOLDEN = 0.6180339887498949;
        let strokeIndex = 0;
        let fillIndex = 0;
        for (const cmd of this.commands) {
            const isStroke = cmd.type === 'stroke';
            const index = isStroke ? strokeIndex++ : fillIndex++;
            const slot = (index * GOLDEN) % 1;
            const jitter = ((index * 2654435761) >>> 0) / 4294967296;
            const delay = slot * (isStroke ? 0.5 : 0.45);
            const span = isStroke ? 0.32 + jitter * 0.26 : 0.4 + jitter * 0.25;
            cmd.staggerDelay = delay;
            cmd.staggerSpan = Math.min(span, 1 - delay);
        }
        this.staggerScheduled = true;
    }

    update(rawProgress: number) {
        // Every command's local window sits inside 0..1, so any progress outside it draws the
        // same thing as the nearest end. Once a shot has fully drawn in, re-tessellating the
        // identical geometry every frame is pure waste.
        const key = Math.min(1, Math.max(0, rawProgress));
        if (key === this.drawnProgress && this.commands.length === this.drawnCommandCount) return;
        this.drawnProgress = key;
        this.drawnCommandCount = this.commands.length;
        this.display.clear();
        if (!this.staggerScheduled) this.scheduleStagger();
        for (let index = 0; index < this.commands.length; index++) {
            const cmd = this.commands[index];
            // A command still waiting for its stagger window draws nothing visible (an alpha-0 fill or
            // a stroke of bare moveTos), but Pixi would still convert its style and tessellate it.
            // Skip it only when neither it nor the next command leans on the shared path state: an
            // arc-led stroke links to the previous end point, or re-strokes the previous fill's path
            // when it emits nothing itself.
            if (
                rawProgress <= cmd.staggerDelay
                && opensOwnPath(cmd)
                && (index + 1 >= this.commands.length || opensOwnPath(this.commands[index + 1]))
            ) continue;
            if (cmd.type === 'fill') {
                this.display.moveTo(0, 0);
                const localRaw = Math.min(
                    1,
                    Math.max(0, (rawProgress - cmd.staggerDelay) / cmd.staggerSpan),
                );
                const localProgress = 1 - Math.pow(1 - localRaw, 3); // Cubic ease-out locally
                let isRectWipe = false;
                if (cmd.path.length === 6 && cmd.path[0].type === 'rect_hint') {
                    isRectWipe = true;
                    const r = cmd.path[0];
                    // Left to right mask wipe: just animate the width
                    this.display.rect(r.x, r.y, r.w * localProgress, r.h);
                }

                if (!isRectWipe) {
                    for (const p of cmd.path) {
                        if (p.type === 'rect_hint') continue;
                        if (p.type === 'moveTo') this.display.moveTo(p.x, p.y);
                        else if (p.type === 'lineTo') this.display.lineTo(p.x, p.y);
                        else if (p.type === 'circle') this.display.circle(p.x, p.y, p.r);
                        else if (p.type === 'arc') this.display.arc(p.cx, p.cy, p.r, p.start, p.end, p.anticlockwise);
                        else if (p.type === 'quadraticCurveTo') this.display.quadraticCurveTo(p.cx, p.cy, p.tx, p.ty);
                        else if (p.type === 'bezierCurveTo') this.display.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.tx, p.ty);
                    }
                }
                const alphaProgress = 1 - Math.pow(1 - Math.min(1, localRaw * 2), 3); // Ease out alpha over the first half of the window
                const alpha = (cmd.options.alpha ?? 1) * alphaProgress;
                this.display.fill({ ...cmd.options, alpha });
            } else if (cmd.type === 'stroke') {
                if (cmd.length <= 0) continue;

                const localRaw = Math.min(
                    1,
                    Math.max(0, (rawProgress - cmd.staggerDelay) / cmd.staggerSpan),
                );
                const localProgress = 1 - Math.pow(1 - localRaw, 3); // Apply cubic ease-out LOCALLY

                const targetLen = cmd.length * localProgress;
                let currentLen = 0;

                for (const p of cmd.path) {
                    if (p.type === 'rect_hint') continue;
                    if (p.type === 'moveTo') {
                        this.display.moveTo(p.x, p.y);
                    } else {
                        if (currentLen >= targetLen) break;

                        if (currentLen + p.len <= targetLen) {
                            if (p.type === 'lineTo') this.display.lineTo(p.x, p.y);
                            else if (p.type === 'circle') this.display.circle(p.x, p.y, p.r);
                            else if (p.type === 'arc') this.display.arc(p.cx, p.cy, p.r, p.start, p.end, p.anticlockwise);
                            else if (p.type === 'quadraticCurveTo') this.display.quadraticCurveTo(p.cx, p.cy, p.tx, p.ty);
                            else if (p.type === 'bezierCurveTo') this.display.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.tx, p.ty);
                            currentLen += p.len;
                        } else {
                            const ratio = (targetLen - currentLen) / p.len;
                            if (p.type === 'lineTo') {
                                const x = p.lastX + (p.x - p.lastX) * ratio;
                                const y = p.lastY + (p.y - p.lastY) * ratio;
                                this.display.lineTo(x, y);
                            } else if (p.type === 'circle') {
                                this.display.arc(p.x, p.y, p.r, 0, Math.PI * 2 * ratio);
                            } else if (p.type === 'arc') {
                                this.display.arc(p.cx, p.cy, p.r, p.start, p.start + p.diff * ratio, p.anticlockwise);
                            } else if (p.type === 'quadraticCurveTo') {
                                const newCpX = p.lastX + ratio * (p.cx - p.lastX);
                                const newCpY = p.lastY + ratio * (p.cy - p.lastY);
                                const newTx = (1-ratio)*(1-ratio)*p.lastX + 2*(1-ratio)*ratio*p.cx + ratio*ratio*p.tx;
                                const newTy = (1-ratio)*(1-ratio)*p.lastY + 2*(1-ratio)*ratio*p.cy + ratio*ratio*p.ty;
                                this.display.quadraticCurveTo(newCpX, newCpY, newTx, newTy);
                            } else if (p.type === 'bezierCurveTo') {
                                const q0x = p.lastX + ratio * (p.c1x - p.lastX);
                                const q0y = p.lastY + ratio * (p.c1y - p.lastY);
                                const q1x = p.c1x + ratio * (p.c2x - p.c1x);
                                const q1y = p.c1y + ratio * (p.c2y - p.c1y);
                                const q2x = p.c2x + ratio * (p.tx - p.c2x);
                                const q2y = p.c2y + ratio * (p.ty - p.c2y);
                                const r0x = q0x + ratio * (q1x - q0x);
                                const r0y = q0y + ratio * (q1y - q0y);
                                const r1x = q1x + ratio * (q2x - q1x);
                                const r1y = q1y + ratio * (q2y - q1y);
                                const bx = r0x + ratio * (r1x - r0x);
                                const by = r0y + ratio * (r1y - r0y);
                                this.display.bezierCurveTo(q0x, q0y, r0x, r0y, bx, by);
                            }
                            currentLen = targetLen;
                            break;
                        }
                    }
                }

                this.display.stroke(cmd.options);
            }
        }
    }
}
