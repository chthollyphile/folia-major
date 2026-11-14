// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachSeamWheelRelay, seamConsumesWheel } from '../../../../src/library/suites/bravais/bravaisSeamWheel';

// 缝里的滚轮（bug 修复用例）：缝是墙的滚轮容器 .lattice-field 的兄弟节点，指针落在信息条 / 书脊 / 标题 /
// 说明文字 / 折叠后的边缘标签上时 wheel 事件冒泡不到墙的监听，整条缝是滚轮死区。bravaisSeamWheel 把缝里的滚轮
// 接回墙上（监听挂在 stage 的根节点上）：缝里真能滚的祖先（展开后溢出的说明、挤满的信息条、横向溢出的首页窄缝）
// 先自己滚，滚到头再交给墙；同一手势里惯性的尾巴留在容器边上。
// 这里的 DOM 按 BravaisStage 的真实结构搭（field、缝、边缘标签是同一个 section 里的兄弟），滚动尺寸用
// defineProperty 摆出来——jsdom 不做排版，scrollHeight / clientHeight 一律为 0。

const buildSeam = () => {
    document.body.innerHTML = `
        <section class="bravais-root" data-bravais-seam-axis="y">
            <div class="lattice-field bravais-field"></div>
            <div class="bravais-seam-track">
                <div class="bravais-seam" data-bravais-seam-axis="y">
                    <div class="bravais-seam-content">
                        <div class="bravais-seam-body">
                            <div class="bravais-seam-row is-full">
                                <button type="button" class="bravais-seam-title-area" id="title"><span>望</span></button>
                                <div class="bravais-seam-row-info" id="info" data-wheel-scroll-region>
                                    <span id="meta">308 首</span>
                                    <button type="button" class="bravais-chrome-button" id="play">播放全部</button>
                                </div>
                                <div class="bravais-seam-blurb is-open" id="blurb" data-wheel-scroll-region>一段很长的简介</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <button type="button" class="bravais-seam-tab" id="tab">信息条</button>
        </section>
    `;
    const root = document.querySelector<HTMLElement>('.bravais-root')!;
    const seam = document.querySelector<HTMLElement>('.bravais-seam')!;
    const field = document.querySelector<HTMLElement>('.lattice-field')!;
    const byId = (id: string) => document.getElementById(id)!;
    return { root, seam, field, tab: byId('tab'), info: byId('info'), meta: byId('meta'), blurb: byId('blurb'), title: byId('title') };
};

type Metrics = { content: number; size: number; position?: number };

/** 让元素看起来像（或不像）一个滚动容器：overflow / 内容尺寸 / 滚动位置。 */
const stubScroll = (element: HTMLElement, axis: 'x' | 'y', { content, size, position = 0 }: Metrics) => {
    const [total, box, offset] = axis === 'y'
        ? ['scrollHeight', 'clientHeight', 'scrollTop'] as const
        : ['scrollWidth', 'clientWidth', 'scrollLeft'] as const;
    Object.defineProperty(element, total, { configurable: true, get: () => content });
    Object.defineProperty(element, box, { configurable: true, get: () => size });
    Object.defineProperty(element, offset, { configurable: true, get: () => position, set: () => {} });
    if (axis === 'y') element.style.overflowY = 'auto';
    else element.style.overflowX = 'auto';
};

/** 墙上那个 onWheel 的替身：拦下默认行为（真身就是 useWallPointerPan 交给 .lattice-field 的处理）。 */
const wallHandler = () => vi.fn((event: WheelEvent) => { event.preventDefault(); });

const wheel = (target: Element, init: WheelEventInit = { deltaY: NOTCH_PX }) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    const notCancelled = target.dispatchEvent(event);
    return { event, defaultPrevented: !notCancelled };
};

/** 这一小段里读了多少次样式（缝的宽度每帧都在被写，读布局越少越好）。 */
const countStyleReads = (run: () => void) => {
    const spy = vi.spyOn(window, 'getComputedStyle');
    run();
    const reads = spy.mock.calls.length;
    spy.mockRestore();
    return reads;
};

/** 手势锁的时长（SEAM_WHEEL_LATCH_MS = 160）之外。 */
const afterLatch = () => new Promise(resolve => setTimeout(resolve, 240));

/** 鼠标滚轮的一格（Chromium 约 100~120，不小于 minNotchPx 才算一格）。 */
const NOTCH_PX = 120;
/** 高分辨率滚轮的一格：Magic Mouse、Windows「每次一行」都是这种恒定的 33px 上下，小于墙判别器的一格（50）。 */
const HIGH_RES_PX = 33;
/** 触控板的一发：单轴，但远小于一格（系统惯性峰值也在这里）。 */
const GLIDE_PX = 12;
/** 连续滚鼠标时相邻两格的间隔（真实是 50~120ms），一直在 160ms 的锁定时间内。 */
const NOTCH_GAP_MS = 80;
/** 高分辨率滚轮比普通滚轮更密：两格之间约 40ms。 */
const HIGH_RES_GAP_MS = 40;
/** 无级滚轮 / Magic Mouse 连转时两格之间比这个更短，和触控板一帧的间隔落在同一个窗口里。 */
const HIGH_RES_SHORT_GAP_MS = 25;
/** 触控板一发与下一发的间隔（约一帧），同一手势里不换来源。 */
const GLIDE_GAP_MS = 16;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 让实现读到的 performance.now 由用例往前推：两发之间 advance 多少就是隔了多少毫秒。
 * jsdom 的 WheelEvent.timeStamp 在构造时就定死（构造函数不收这个值），所以时间判据只能靠这条时钟来钉。
 * 手势锁本身的 window.setTimeout 还是真实计时：这里只推时钟，不停真时间，用例可以同步跑完。
 */
const seamClock = () => {
    let now = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    return {
        advance: (ms: number) => { now += ms; },
        restore: () => { spy.mockRestore(); },
    };
};

/** 触控板的一发：小增量，墙的判别器把它算作 trackpad。 */
const glide = (target: Element, init: WheelEventInit = {}) => wheel(target, { deltaY: GLIDE_PX, ...init });

/** 一股系统惯性：峰值之后逐发变小，直到 1（真实系统甩出去之后每一发都比上一发小）。 */
const decaySeries = (peak: number, ratio = 0.6) => {
    const series: number[] = [];
    for (let value = peak; value > 1;) {
        const next = Math.max(1, Math.floor(value * ratio));
        if (next >= value) break;
        series.push(next);
        value = next;
    }
    return series;
};

const pointerMove = (x: number, y: number) => {
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
};

afterEach(() => { document.body.innerHTML = ''; });

describe('缝里的滚轮接到墙上', () => {
    it('bug 的结构原因：缝里的 wheel 冒泡不到墙的滚轮容器，边缘标签也不在缝里面', () => {
        const { root, seam, field, tab, meta } = buildSeam();
        const onWall = vi.fn();
        field.addEventListener('wheel', onWall);
        wheel(meta);
        // field 与 seam 是兄弟节点，事件不经过 field —— 这就是信息条 / 书脊 / 标题上一滚就没有反应的原因。
        expect(onWall).not.toHaveBeenCalled();
        expect(seam.contains(meta)).toBe(true);
        // 折叠后唯一能停指针的面上是这条边缘标签：它是 seam 之外的第三个同级节点，所以 relay 的根必须提到 stage。
        expect(seam.contains(tab)).toBe(false);
        expect(root.contains(tab)).toBe(true);
        field.removeEventListener('wheel', onWall);
    });

    it('信息条装得下时（不能滚）：滚轮交给墙，页面照常滚', () => {
        const { root, meta, info } = buildSeam();
        // .bravais-seam-row-info 是 overflow-y: auto，308 首这类内容在横条里装得下 → 它滚不动。
        stubScroll(info, 'y', { content: 120, size: 120 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const result = wheel(meta);
        expect(forward).toHaveBeenCalledTimes(1);
        expect(forward.mock.calls[0][0]).toBe(result.event);
        expect(result.defaultPrevented).toBe(true);
        detach();
    });

    it('列表容器装得下时（滚不动）交给墙，不变成新的死区', () => {
        const { root, seam } = buildSeam();
        // 组件用例里列表面板由 react-window 撑满，这里补「装得下」的那一支：面板的 List 根节点有 overflow: auto
        // 但内容比框矮 → 它不吃这一下，滚轮照常交给墙。
        const list = document.createElement('div');
        list.dataset.bravaisList = '';
        list.innerHTML = '<button type="button" id="list-row">第一首</button>';
        seam.querySelector('.bravais-seam-body')!.appendChild(list);
        stubScroll(list, 'y', { content: 80, size: 80 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(wheel(document.getElementById('list-row')!).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('书脊 / 标题上没有能滚的东西：同样交给墙', () => {
        const { root, title } = buildSeam();
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(wheel(title).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('折叠后指针停在边缘标签上滚轮，也交给墙（标签在缝之外，靠 stage 那层根覆盖）', () => {
        const { root, tab } = buildSeam();
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const result = wheel(tab);
        expect(forward).toHaveBeenCalledTimes(1);
        expect(forward.mock.calls[0][0]).toBe(result.event);
        expect(result.defaultPrevented).toBe(true);
        detach();
    });

    it('落在 .lattice-field 里的 wheel 归墙自己那份监听：relay 不重复处理', () => {
        const { root, field } = buildSeam();
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const result = wheel(field);
        expect(forward).not.toHaveBeenCalled();
        // 没被 relay 拦下（真身里 field 自己的 onWheel 已经 preventDefault 过一次）。
        expect(result.defaultPrevented).toBe(false);
        detach();
    });

    it('墙的手势锁在 window 捕获阶段截下的事件，relay 不再接一手（提升根节点不影响那条语义）', () => {
        const { root, meta } = buildSeam();
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        // useWallPointerPan 的 onLatchedWheel：锁定时对不在 container 里的目标 stopPropagation 后自己处理。
        const lock = (event: Event) => event.stopPropagation();
        window.addEventListener('wheel', lock, { capture: true });
        const result = wheel(meta);
        window.removeEventListener('wheel', lock, { capture: true });
        expect(forward).not.toHaveBeenCalled();
        expect(result.defaultPrevented).toBe(false);
        detach();
    });

    it('展开后真溢出的说明文字先自己滚，不交给墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        // 往下滚：还能滚，原生滚动交给浏览器（不 preventDefault、不推相机）。
        expect(wheel(blurb).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('说明文字滚到底后再滚：交给墙（不在缝里停住）', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(wheel(blurb).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('说明文字滚到顶后往上滚，也接着滚页面', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(wheel(blurb, { deltaY: -120 }).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('触控板甩到底：惯性尾巴留在容器边上，停手超过锁定时间后才交给墙', async () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        // 第一下真的让说明文字自己滚。
        expect(glide(blurb).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        // 甩到底：后面这一手剩下的惯性事件还在同一手势里，不能接着推墙（原来会「滚完简介接着推墙」）。
        // 送进去的是系统惯性的样子：每一发都比上一发小。
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        for (const deltaY of decaySeries(GLIDE_PX)) {
            await sleep(GLIDE_GAP_MS);
            expect(glide(blurb, { deltaY }).defaultPrevented).toBe(false);
        }
        expect(forward).not.toHaveBeenCalled();
        // 停手再滚是新手势：交给墙。
        await afterLatch();
        expect(wheel(blurb).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('鼠标滚轮滚到边后下一格就交给墙：一格一格的间隔（50~120ms）落在锁定时间内也不续命', async () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        // 第一格：说明文字自己滚，墙不动。
        expect(wheel(blurb).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        // 滚到底后继续滚：下一格离上一格只有一格滚轮的间隔，远不够解开锁，但它已经是新的一手——
        // 说明文字没得可滚，就交给墙，不必先停手 160ms。
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        await sleep(NOTCH_GAP_MS);
        const atEdge = wheel(blurb);
        expect(atEdge.defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        // 接着滚还是推墙：没在边界上重新锁住自己。
        await sleep(NOTCH_GAP_MS);
        expect(wheel(blurb).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(2);
        detach();
    });

    it('离散鼠标滚轮还在能滚的时候连着滚：一直是说明文字自己滚，不交替推墙', async () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        for (let index = 0; index < 4; index += 1) {
            await sleep(NOTCH_GAP_MS);
            expect(wheel(blurb).defaultPrevented).toBe(false);
        }
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('高分辨率滚轮（一格 33px、增量恒定）滚到边后继续推墙：小增量不等于触控板', async () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const notch = (deltaY: number) => wheel(blurb, { deltaY });
        // 第一格：说明文字自己滚，墙不动。
        expect(notch(HIGH_RES_PX).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        // 滚到底：后面每一格都是恒定的 33px（无级滚轮、Windows「每次一行」都是这样），间隔还比普通滚轮更密。
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        for (let index = 0; index < 3; index += 1) {
            await sleep(HIGH_RES_GAP_MS);
            expect(notch(HIGH_RES_PX).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(index + 1);
        }
        detach();
    });

    it('触控板惯性（40 逐发衰减到 1、间隔约一帧）甩到边后不推墙', async () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const glideBy = (deltaY: number) => wheel(blurb, { deltaY });
        // 甩的第一发还在能滚的位置：说明文字自己滚。
        expect(glideBy(40).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        // 甩到底之后剩下的惯性：每一发都比上一发小，整段都留在容器边上。
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        for (const deltaY of [24, 14, 8, 5, 3, 2, 1]) {
            await sleep(GLIDE_GAP_MS);
            expect(glideBy(deltaY).defaultPrevented).toBe(false);
        }
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('触控板甩动的峰值不小于一格（60px）时，接着的衰减尾巴照样不推墙', async () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        // 快速一甩的前几发单轴也可能不小于 minNotchPx（50），墙的判别器本来就会把它们当滚轮。
        expect(wheel(blurb, { deltaY: 60 }).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        // 51 仍然不小于一格：只看「它比上一发小」才认得出这是同一次甩动的尾巴。
        for (const deltaY of [51, 40, 30, 22, 16, 11, 8, 5, 3, 2, 1]) {
            await sleep(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
        }
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('惯性尾巴里有相邻相等时也不推墙：真实系统尾巴常是 …3,2,2,1,1,1', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            // 甩的第一发还在能滚的位置：说明文字自己滚，锁住这一手（峰值 40）。
            expect(wheel(blurb, { deltaY: 40 }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            // 甩到底之后剩下的惯性：相邻两发可能相等（系统按帧送，合并之后数值不变）。
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            for (const deltaY of [24, 24, 14, 14, 8, 5, 5, 3, 2, 2, 1, 1, 1]) {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
            }
            expect(forward).not.toHaveBeenCalled();
        } finally {
            clock.restore();
            detach();
        }
    });

    it('惯性尾巴里的小幅回升也不推墙：Chromium 合并事件后有 22→23 这种回升', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: 40 }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 回升不超过峰值两倍、且紧挨着上一发（一帧）：仍是同一次甩动的尾巴。
            for (const deltaY of [24, 22, 23, 18, 16, 17, 10, 6, 3, 1]) {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
            }
            expect(forward).not.toHaveBeenCalled();
        } finally {
            clock.restore();
            detach();
        }
    });

    it('滚轮减速（240 之后恒定的 120、间隔 80ms）最多吞一格，之后就推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            // 第一格是 240：说明文字自己滚，锁住（峰值 240）。
            expect(wheel(blurb, { deltaY: 240 }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 240 → 120 是逐发变小，算同一手的尾巴，吞掉这一格。
            clock.advance(GLIDE_GAP_MS * 5);
            expect(wheel(blurb, { deltaY: 120 }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            // 之后增量恒定、间隔又是一格滚轮的 80ms（远大于惯性的一帧）：新的一手，交给墙。
            for (let index = 0; index < 2; index += 1) {
                clock.advance(NOTCH_GAP_MS);
                expect(wheel(blurb, { deltaY: 120 }).defaultPrevented).toBe(true);
                expect(forward).toHaveBeenCalledTimes(index + 1);
            }
        } finally {
            clock.restore();
            detach();
        }
    });

    it('高分辨率滚轮增量恒定 33、间隔 40ms：到边后照样推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            for (let index = 0; index < 3; index += 1) {
                clock.advance(HIGH_RES_GAP_MS);
                expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(true);
                expect(forward).toHaveBeenCalledTimes(index + 1);
            }
        } finally {
            clock.restore();
            detach();
        }
    });

    it('高分辨率滚轮 33 恒定、间隔 25ms：同样大小连到第 4 次就认定是滚轮，第 4 发起推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            // 第一格：说明文字自己滚，锁住这一手。恒定 33 的滚轮从这一发起就是同一个大小。
            expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 无级滚轮 / Magic Mouse 连转时两格之间只要 25ms，和惯性尾巴一帧的间隔落在同一个窗口里，
            // 只是「33 恒定」这一条看不出是滚轮。同样大小连到第 4 次（本手第 1 格也算一次）就不当尾巴：
            // 第 4 发起推墙，之后这一手不再重新锁住自己。
            const pushes = [false, false, true, true, true];
            pushes.forEach((pushesWall, index) => {
                clock.advance(HIGH_RES_SHORT_GAP_MS);
                expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(pushesWall);
                expect(forward).toHaveBeenCalledTimes(pushesWall ? index - 1 : 0);
            });
            expect(forward).toHaveBeenCalledTimes(3);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('高分辨率滚轮 33 恒定、间隔 16ms（和触控板同一帧量级）：同样连到第 4 次也推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(false);
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 一帧量级的间隔正是惯性尾巴的样子，唯一认得出滚轮的只有「同样大小连着来」这一条。
            const pushes = [false, false, true, true, true];
            pushes.forEach((pushesWall, index) => {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(pushesWall);
                expect(forward).toHaveBeenCalledTimes(pushesWall ? index - 1 : 0);
            });
        } finally {
            clock.restore();
            detach();
        }
    });

    it('系统惯性尾巴 40,24,24,14,14,8,5,5,3,2,2,1,1,1,1,1、间隔 16ms：整段都不推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: 40 }).defaultPrevented).toBe(false);
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 真实尾巴带上末端的相等平台期：连击计数只数不小于 3px 的那几发，1,1,1,1,1 是平台期不计数，
            // 所以整段都被当成尾巴，一发都不推墙。
            for (const deltaY of [24, 24, 14, 14, 8, 5, 5, 3, 2, 2, 1, 1, 1, 1, 1]) {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
            }
            expect(forward).not.toHaveBeenCalled();
        } finally {
            clock.restore();
            detach();
        }
    });

    it('尾巴里 8,8,8,8、间隔 16ms（不小于 3px 且连着 4 次）：第 4 发推墙，为 33px 滚轮付的代价', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            // 匀速滑到头：每一发都一样大，形状和 33 恒定、间隔一帧的滚轮分不开，第 4 发按滚轮处理。
            expect(wheel(blurb, { deltaY: 8 }).defaultPrevented).toBe(false);
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            for (const deltaY of [8, 8]) {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
            }
            expect(forward).not.toHaveBeenCalled();
            clock.advance(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY: 8 }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(1);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('尾巴里 ≥3px 与 <3px 交替（24,2,24,2,…）、间隔 16ms：第 4 个 24（第 7 发）推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: 24 }).defaultPrevented).toBe(false);
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 小于 3px 的那一发完全忽略：不计数、不清零、也不动比较基准。24 始终和上一次不小于 3px 的增量
            // （还是 24）比，所以这条链一路数下去，第 4 个 24 就是第 7 发，按恒定连转的滚轮交给墙。
            for (const deltaY of [2, 24, 2, 24, 2]) {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
            }
            expect(forward).not.toHaveBeenCalled();
            clock.advance(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY: 24 }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(1);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('无级滚轮夹进 1~2px（33,2,33,2,…）、间隔 16ms：第 4 个 33（第 7 发）推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            // Magic Mouse / 精度触控板夹在中间的 1~2px 不该把恒定 33px 的连转打断：没有这一条，缝里滚到头
            // 之后整段都是 0 推墙，墙不动。
            expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(false);
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            for (const deltaY of [2, HIGH_RES_PX, 2, HIGH_RES_PX, 2]) {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
            }
            expect(forward).not.toHaveBeenCalled();
            clock.advance(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(1);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('无级滚轮的两格之间夹 1px（33,33,1,33,33,1,…）、间隔 16ms：第 4 个 33 推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(false);
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 两格连在一起、中间只漏一发 1px 是精度触控板的常态：1px 不计数也不清零，33,33 照常累加。
            for (const deltaY of [HIGH_RES_PX, 1, HIGH_RES_PX]) {
                clock.advance(GLIDE_GAP_MS);
                expect(wheel(blurb, { deltaY }).defaultPrevented).toBe(false);
            }
            expect(forward).not.toHaveBeenCalled();
            clock.advance(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY: HIGH_RES_PX }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(1);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('已知边界：相等平台期后主线程卡了 45ms（40,24,[45ms]24,…）会推墙一小段', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: 40 }).defaultPrevented).toBe(false);
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            clock.advance(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY: 24 }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            // 卡顿把两发之间的间隔撑过 30ms：这一发和惯性里「换了一格滚轮」长得一样，只能当新的一手。
            clock.advance(45);
            expect(wheel(blurb, { deltaY: 24 }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(1);
            // 锁已经解开，后面这一小段尾巴也接着推墙（已知边界，不是本用例要修的东西）。
            clock.advance(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY: 14 }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(2);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('标准滚轮增量恒定 120、间隔 80ms：到边后照样推墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: NOTCH_PX }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            for (let index = 0; index < 3; index += 1) {
                clock.advance(NOTCH_GAP_MS);
                expect(wheel(blurb, { deltaY: NOTCH_PX }).defaultPrevented).toBe(true);
                expect(forward).toHaveBeenCalledTimes(index + 1);
            }
        } finally {
            clock.restore();
            detach();
        }
    });

    it('滚轮从 120 变大到 240（间隔 80ms）：增量变大就是新的一手，交给墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: NOTCH_PX }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            clock.advance(NOTCH_GAP_MS);
            // 240 正好是峰值两倍，但间隔 80ms 不是惯性的一帧：重判之后交给墙。
            expect(wheel(blurb, { deltaY: NOTCH_PX * 2 }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(1);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('deltaMode 变了就是换了来源：上一发按像素、这一发按行，不当成尾巴', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const clock = seamClock();
        try {
            expect(wheel(blurb, { deltaY: 40 }).defaultPrevented).toBe(false);
            expect(forward).not.toHaveBeenCalled();
            stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
            // 挨着一帧送来的 3 行（48px）没超过峰值两倍、间隔也够小，但单位编码换了：这不是上一手的惯性尾巴。
            clock.advance(GLIDE_GAP_MS);
            expect(wheel(blurb, { deltaY: 3, deltaMode: 1 }).defaultPrevented).toBe(true);
            expect(forward).toHaveBeenCalledTimes(1);
        } finally {
            clock.restore();
            detach();
        }
    });

    it('deltaMode = 1（按行）的衰减尾巴也不推墙：按行上报不等于滚轮', async () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const line = (deltaY: number) => wheel(blurb, { deltaY, deltaMode: 1 });
        expect(line(3).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        for (const deltaY of [2, 1]) {
            await sleep(GLIDE_GAP_MS);
            expect(line(deltaY).defaultPrevented).toBe(false);
        }
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('deltaMode = 2（按页）用传进来的视口高度换算，不另外读 window', () => {
        const { root, info, meta } = buildSeam();
        // 信息条已经滚到底：没有锁的时候这一下就该交给墙。
        stubScroll(info, 'y', { content: 420, size: 240, position: 180 });
        // 先让信息条自己吃下一发（它还能滚），锁住 33px 这一手。
        stubScroll(info, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward, () => 50);
        expect(wheel(meta, { deltaY: 33 }).defaultPrevented).toBe(false);
        stubScroll(info, 'y', { content: 420, size: 240, position: 180 });
        // 一页 = 传入的 50px：比上一发（33）大 → 解开锁重判 → 交给墙。
        expect(wheel(meta, { deltaY: 1, deltaMode: 2 }).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();

        // 换一个更小的视口：一页只有 8px，比上一发小 → 当成同一次甩动的尾巴，留在容器边上。
        stubScroll(info, 'y', { content: 420, size: 240, position: 0 });
        const small = wallHandler();
        const detachSmall = attachSeamWheelRelay(root, small, () => 8);
        expect(wheel(meta, { deltaY: 33 }).defaultPrevented).toBe(false);
        stubScroll(info, 'y', { content: 420, size: 240, position: 180 });
        expect(wheel(meta, { deltaY: 1, deltaMode: 2 }).defaultPrevented).toBe(false);
        expect(small).not.toHaveBeenCalled();
        detachSmall();
        // 同一个事件按 jsdom 的 window.innerHeight（768）换算是 768px，比 33 大——上面两次只要读到 window 就会走反。
        expect(window.innerHeight).not.toBe(50);
    });

    it('光标挪开超过 4px 也算换了目标：锁定解开，边界上的滚轮交给墙', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        glide(blurb);
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        expect(glide(blurb, { deltaY: GLIDE_PX - 4 }).defaultPrevented).toBe(false);
        pointerMove(120, 120);
        expect(wheel(blurb).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('手势尾巴期间不再做布局读取（同一次手势的触控板事件不重新算边界）', () => {
        const { root, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        const readStyle = vi.spyOn(window, 'getComputedStyle');
        glide(blurb);
        const afterFirst = readStyle.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);
        stubScroll(blurb, 'y', { content: 420, size: 240, position: 180 });
        for (const deltaY of decaySeries(GLIDE_PX)) glide(blurb, { deltaY });
        expect(readStyle.mock.calls.length).toBe(afterFirst);
        readStyle.mockRestore();
        detach();
    });

    it('带标记的滚动容器命中后只在它这一层算边界（目标到它之间不再逐层读样式）', () => {
        const { root, info, meta } = buildSeam();
        stubScroll(info, 'y', { content: 420, size: 240, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        // meta 是信息条里的一个 span：标记命中就直接看信息条，span 自己不必再问一次「你是不是滚动容器」。
        expect(countStyleReads(() => { wheel(meta); })).toBe(1);
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('标记的容器装得下时退回通用遍历：里面没标记的滚动容器照样自己滚', () => {
        const { root, info } = buildSeam();
        // 标记的这层装得下（滚不动），但它里面还有一个没标记、真能滚的容器：通用路径必须还能找到它，
        // 不能因为「命中过标记」就一路交给墙（列表面板里 react-window 的外层就是这种没标记的滚动容器）。
        stubScroll(info, 'y', { content: 120, size: 120 });
        const inner = document.createElement('div');
        inner.innerHTML = '<span id="inner-span">第一首</span>';
        info.appendChild(inner);
        stubScroll(inner, 'y', { content: 400, size: 200, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(wheel(document.getElementById('inner-span')!).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('首页窄缝横向溢出：还能横向滚就先自己滚，到底了交回墙上', async () => {
        const { root, seam } = buildSeam();
        const nav = document.createElement('div');
        nav.className = 'bravais-seam-home-row-nav';
        nav.innerHTML = '<button type="button" id="nav-tab">书库</button>';
        seam.querySelector('.bravais-seam-body')!.appendChild(nav);
        const navTab = document.getElementById('nav-tab')!;

        stubScroll(nav, 'x', { content: 600, size: 320, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(glide(navTab, { deltaX: GLIDE_PX, deltaY: 0 }).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();

        stubScroll(nav, 'x', { content: 600, size: 320, position: 280 });
        // 同一手势里触控板惯性还没停：仍然留在容器边上。
        expect(glide(navTab, { deltaX: GLIDE_PX - 6, deltaY: 0 }).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        // 停手之后再滚，才交给墙。
        await afterLatch();
        expect(wheel(navTab, { deltaX: 120, deltaY: 0 }).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('Shift + 竖向滚轮在横向溢出的首页窄缝上先自己滚（和墙同一套换算）', () => {
        const { root, seam } = buildSeam();
        const nav = document.createElement('div');
        nav.className = 'bravais-seam-home-row-nav';
        nav.innerHTML = '<button type="button" id="shift-tab">书库</button>';
        seam.querySelector('.bravais-seam-body')!.appendChild(nav);
        const navTab = document.getElementById('shift-tab')!;

        stubScroll(nav, 'x', { content: 600, size: 320, position: 0 });
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        // 不用 Shift：这一下是竖向的，窄缝没有纵向溢出 → 交给墙。
        expect(wheel(navTab, { deltaY: 120 }).defaultPrevented).toBe(true);
        expect(forward).toHaveBeenCalledTimes(1);
        // 按住 Shift：wallWheelDelta 把竖向改走横向，窄缝这一下还能横向滚 → 自己滚。
        expect(wheel(navTab, { deltaY: 120, shiftKey: true }).defaultPrevented).toBe(false);
        expect(forward).toHaveBeenCalledTimes(1);
        detach();
    });

    it('已经被 preventDefault 过的 wheel 不再 forward', () => {
        const { root, meta } = buildSeam();
        const swallow = (event: Event) => event.preventDefault();
        meta.addEventListener('wheel', swallow);
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(wheel(meta).defaultPrevented).toBe(true);
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('Ctrl / ⌘ + 滚轮（缩放）既不拦也不推', () => {
        const { root, meta } = buildSeam();
        const forward = wallHandler();
        const detach = attachSeamWheelRelay(root, forward);
        expect(wheel(meta, { deltaY: 120, ctrlKey: true }).defaultPrevented).toBe(false);
        expect(wheel(meta, { deltaY: 120, metaKey: true }).defaultPrevented).toBe(false);
        expect(forward).not.toHaveBeenCalled();
        detach();
    });

    it('卸载后缝里不再接滚轮', () => {
        const { root, meta } = buildSeam();
        const forward = wallHandler();
        attachSeamWheelRelay(root, forward)();
        wheel(meta);
        expect(forward).not.toHaveBeenCalled();
    });

    it('没有根节点（null）时退化成什么都不做，不抛错', () => {
        const forward = wallHandler();
        expect(() => attachSeamWheelRelay(null, forward)()).not.toThrow();
        expect(forward).not.toHaveBeenCalled();
    });
});

describe('seamConsumesWheel 的方向判断', () => {
    it('装得下（content 不大于 size）的 overflow: auto 不算能滚', () => {
        const { seam, info } = buildSeam();
        stubScroll(info, 'y', { content: 100, size: 100 });
        expect(seamConsumesWheel(info, seam, 0, 120)).toBe(false);
    });

    it('overflow: visible 的元素即使内容更高也不算能滚（它滚不动）', () => {
        const { seam, blurb } = buildSeam();
        stubScroll(blurb, 'y', { content: 800, size: 240 });
        blurb.style.overflowY = 'visible';
        expect(seamConsumesWheel(blurb, seam, 0, 120)).toBe(false);
    });

    it('事件目标不是元素（document）时交给墙', () => {
        const { seam } = buildSeam();
        expect(seamConsumesWheel(document, seam, 0, 120)).toBe(false);
    });
});
