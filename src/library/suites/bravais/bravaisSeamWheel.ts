import { wallWheelDelta } from '../../../components/wall/wallPanMotion';

// src/library/suites/bravais/bravaisSeamWheel.ts
// 缝（含折叠后那条边缘标签）里的滚轮接回墙：缝里能滚的容器先自己滚，其余交给墙的同一个 onWheel。

// 缝（横条 / 竖缝 / 书脊 / 首页窄缝）盖在墙上面，却是墙的滚轮容器 .lattice-field 的兄弟节点
// （BravaisStage 的渲染：field 一个子节点、BravaisSeam 紧挨在后面）。墙的滚轮平移只挂在 .lattice-field 上
// （useWallPointerPan 的 container.addEventListener('wheel', onWheel)），所以指针落在缝里时 wheel 事件
// 既不在 field 内、也冒泡不到它，整条缝是一块滚轮死区——信息条、书脊、标题、说明文字上都一样。
// 折叠 / 隐藏时缝的 width 收到 0、visibility: hidden，唯一能停指针的面是缝之外的第三个同级节点
// .bravais-seam-tab（BravaisSeam 的渲染），所以监听挂在 stage 的 <section> 上，不是挂在缝上。
// 这里把缝里的滚轮接回墙上，规则按「谁该吃掉这一下」分：
// 1. 缝里真有一个能滚的祖先（展开后放不下的说明文字 .bravais-seam-blurb.is-open、挤满时的 .bravais-seam-row-info、
//    横向溢出的首页窄缝导航段）且这一下还没到头 → 让它自己滚，不拦。
// 2. 其余（含「已经滚到头」）→ 拦下来交给墙上同一个滚轮处理，相机接着走。
// 触控板甩到边界之后剩下的惯性事件不会一转手就变成推墙：一个容器吃下一手后，同一手势里剩下的增量继续归它。
// 怎么算「同一手」看三条（见下面 SEAM_WHEEL_LATCH_MS / SEAM_WHEEL_REPEAT_GAP_MS / SEAM_WHEEL_FLAT_CHAIN_MAX
// 与 onWheel 里的判断）：
// 1. 增量比上一发小（严格衰减）→ 续锁，不看间隔。系统惯性每一发都比上一发小，这条不受合并事件影响。
// 2. 增量不超过本手峰值的两倍、且离上一发不到 SEAM_WHEEL_REPEAT_GAP_MS、deltaMode 与上一发相同，并且这一手
//    里「没比上一次不小于 3px 的增量小、自己也不小于 3px」的增量还没连着出现第 4 次 → 续锁。这条兜住惯性
//    尾巴里相邻相等的平台期（…3,2,2,1,1,1）和小幅回升（22→23，Chromium 会把相邻事件合并后数值加倍），也把
//    同样大小连着来的滚轮认出来（见下面「恒定的连转」）。链条只连着数不小于 3px 的发：小于 3px 的那一发完全
//    忽略，不计数、也不清零——它夹在恒定连转里（33,2,33,2…）时不打断这条链，第 4 个 33 照样交给墙。
// 3. 其余 → 解开锁重新判边界。鼠标滚轮一格的间隔（50~120ms）填不满 160ms，但每一格都落在第三条上，所以
//    「滚到底再滚一格」这一格就交给墙，不必先停手；一格也算一手（含单轴小于 50px 的高分辨率滚轮：Magic Mouse、
//    Windows 设成「每次一行」的 33px 一格）。
// 来源不能只看时间间隔（连续滚轮的间隔 50~120ms 也在手势间隔以内），也不能只看增量大小（触控板甩动的峰值
// 也会不小），所以按增量怎么变、配上一帧量级的间隔来分：惯性尾巴逐发衰减或在一帧内小幅抖动，滚轮一格的
// 增量恒定、重复或变大。但「滚轮两格之间的间隔明显更长」只是个假设：无级滚轮 / Magic Mouse 连转时两格能挨到
// 16~25ms，和触控板一帧的尾巴形状一样，这时唯一认得出滚轮的是「同样大小连着来」——所以判据 2 加了连续次数
// 上限，第 4 发就 releaseLatch 交给墙。时间用自己记的 performance.now()，不用 event.timeStamp（合成事件的
// 那个值在构造时就定死，判不出间隔）。
//
// 代价（有意取舍）：手指按在触控板上匀速滑到头时，每一发都一样大，第 4 发起会推墙。
//
// 已知边界：
// - 每格都比上一格小的减速连滚（如 240 之后 120,120，间隔 80ms）会被整段当成尾巴，「变小」这一条不看间隔也
//   不看连续次数，要等到出现相等或变大的那一格才交回墙。
// - 主线程卡顿 >30ms 正好落在相等或回升的那一发上时，那一发越过 SEAM_WHEEL_REPEAT_GAP_MS，会被当成新的一手，
//   尾巴可能推墙一小段（用例「已知边界：主线程卡了 45ms」钉着这个现状）。
// - 相邻相等的平台期如果整体不小于 3px（…3,3,3,3），这里和「恒定连转的滚轮」分不开，第 4 发就交给墙：
//   匀速滑到头、每一发都一样大就是这样（用例「尾巴里 8,8,8,8…第 4 发推墙」钉着这个现状）。
// - 小于 3px 的一发不参与计数、也不清零，所以 ≥3 / <3 交替（24,2,24,2…、33,2,33,2…、33,33,1,33,33,1…）
//   里那些不小于 3px 的增量会一路数下去，第 4 个就是第 7 发，交给墙。无级滚轮 / 精度触控板夹进 1~2px 正是
//   这个形状，这里要的就是它推墙；真实的惯性尾巴不会这样交替，所以这个代价不在实际路径上。
//
// 墙的滚轮容器 .lattice-field 里的 wheel 由 useWallPointerPan 自己处理，这里不重复接；但墙自己的手势锁是
// 在 window 捕获阶段把事件截走的（onLatchedWheel），指针停在缝里、墙正锁着手势时，事件在捕获阶段就被它
// stopPropagation 掉了，到不了这里的根监听——那段归墙，不需要 relay 兜。

/**
 * 墙的滚轮容器：落在这里面的 wheel 由 useWallPointerPan 自己那份监听处理，relay 不重复接。
 * 它也会被墙的手势锁管住（onLatchedWheel）：锁定期间的事件在 window 捕获阶段就被 stopPropagation 截走，
 * 指针停在缝里也一样到不了这里的根监听。
 */
const WALL_FIELD_SELECTOR = '.lattice-field';
/** 缝里已知的滚动容器自己带这个标记（仓库既有约定，见 GridView.tsx / CustomSelectMenu.tsx）。 */
const SCROLL_REGION_SELECTOR = '[data-wheel-scroll-region]';
/** 这几个 overflow 值才是滚动容器：overflow: visible 的元素 scrollHeight 也会大于 clientHeight，但它滚不动。 */
const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);
/** 到头 / 到顶的容差：分数滚动位置（缩放后的 DPR）留一点余地，免得最后一格被当成「还能滚」而吃掉。 */
const EDGE_TOLERANCE_PX = 1;
/**
 * 触控板一次手势的尾巴：某个容器吃过一次后，这么久没有新的 wheel 才解锁（和 useWallPointerPan 的 WHEEL_LATCH_MS 同值）。
 * 时间只管停手，不管来源：鼠标滚轮的一格也在这么长的间隔内，算不算同一手看下面的增量判据。
 */
const SEAM_WHEEL_LATCH_MS = 160;
/**
 * 相邻两发在这个间隔内才算「接着上一发」，别看增量有没有变小。
 * 系统惯性按帧送（一帧 8~16ms），所以惯性尾巴里的相等平台期和小幅回升都落在这个窗口里。这一条只用来认
 * 「没变小的那一发」，变小的不用看间隔。
 *
 * 「两格之间的间隔比一帧长」只是个假设（高分辨率滚轮通常约 40ms 以上，但无级滚轮 / Magic Mouse 连转时
 * 能挨到 16~25ms，和触控板一帧的尾巴一样密），所以这个间隔兜不住所有滚轮，另由下面的连续不衰减次数兜底。
 */
const SEAM_WHEEL_REPEAT_GAP_MS = 30;
/**
 * 同一手里「增量没比上一次不小于 3px 的增量小」连着来了几次的上限（第一发就算一次）。超过就是滚轮 /
 * Magic Mouse 那种恒定的连转，不是惯性尾巴——尾巴第二发就该变小，最多在末端有相等或回升的一两发。
 * 超过它也可以理解为这一手是滚轮，开锁交给墙；开锁时归 0，严格衰减时置 1（不是归 0）。
 */
const SEAM_WHEEL_FLAT_CHAIN_MAX = 3;
/**
 * 上头那个次数只数不小于这个像素数的几发：小于 3px 的相等平台期是尾巴末端的常客（…2,2,1,1,1,1），
 * 不计数，也就不会因为末尾一长串 1px 被当成滚轮；它同样不写比较基准、不清零，
 * 所以夹在恒定连转里的 1~2px 不打断那条链。
 */
const SEAM_WHEEL_FLAT_CHAIN_MIN_PX = 3;
/** 光标真的挪开这么远也算换了目标，解锁。 */
const LATCH_MOVE_PX = 4;

const isScrollContainer = (element: HTMLElement, axis: 'x' | 'y') => {
    const style = window.getComputedStyle(element);
    return SCROLLABLE_OVERFLOW.has(axis === 'y' ? style.overflowY : style.overflowX);
};

/** 这个元素在这一下滚轮的方向上还能不能滚：装得下不算，滚到头 / 到顶也不算。 */
const canScrollBy = (element: HTMLElement, axis: 'x' | 'y', delta: number) => {
    if (delta === 0 || !isScrollContainer(element, axis)) return false;
    const size = axis === 'y' ? element.clientHeight : element.clientWidth;
    const total = axis === 'y' ? element.scrollHeight : element.scrollWidth;
    if (total - size <= EDGE_TOLERANCE_PX) return false;
    const position = axis === 'y' ? element.scrollTop : element.scrollLeft;
    return delta > 0
        ? position + size < total - EDGE_TOLERANCE_PX
        : position > EDGE_TOLERANCE_PX;
};

/**
 * 这一下滚轮该由缝里的某个滚动容器吃掉吗：从事件目标往上找到 root（含），遇到第一个在这方向上还能滚的
 * 滚动容器就交给它。位移用 wallWheelDelta 归一（按行 / 页换算、Shift + 竖向改走横向），和墙的判断同一套。
 *
 * 带 data-wheel-scroll-region 的容器走前面那一步快速判断：缝的宽度每帧都在被写（useBravaisFrame），
 * 目标到容器之间的那几层没必要为了「是不是滚动容器」再读一遍 computed overflow。它装得下 / 到头了，
 * 就把判断让回下面的通用遍历——未标记的容器（列表面板里 react-window 的外层）照样能自己滚。
 */
export const seamConsumesWheel = (target: EventTarget | null, root: HTMLElement, dx: number, dy: number) => {
    if (!(target instanceof Element)) return false;
    const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    const delta = axis === 'x' ? dx : dy;
    if (delta === 0) return false;
    const marked = target.closest(SCROLL_REGION_SELECTOR);
    if (marked && root.contains(marked) && canScrollBy(marked as HTMLElement, axis, delta)) return true;
    for (let element: Element | null = target; element; element = element.parentElement) {
        if (canScrollBy(element as HTMLElement, axis, delta)) return true;
        if (element === root) break;
    }
    return false;
};

/**
 * 把缝里的滚轮接到墙上（forward 就是 useWallPointerPan 交给 .lattice-field 的那个 onWheel：
 * preventDefault、推相机、顺手接管手势锁定；viewportHeight 取墙量到的视口高度，按页滚的滚轮要用它换算）。
 * 返回卸载函数。
 */
export const attachSeamWheelRelay = (
    root: HTMLElement | null,
    forward: (event: WheelEvent) => void,
    viewportHeight: () => number = () => window.innerHeight,
) => {
    if (!root) return () => {};
    // 同一手势的锁：谁先吃下这一手就归谁，直到停手 SEAM_WHEEL_LATCH_MS 或光标挪开。锁定期间不碰布局。
    let latch: { timer: number; x: number; y: number } | null = null;
    // 锁在，才需要判别事件是不是同一手势；每次解锁都清零，免得上一手的记忆漏进新手势。
    /** 锁住这一手最后一次吃下的增量大小（两轴取大）：惯性尾巴每一发都不比它大。 */
    let previous = 0;
    /**
     * 锁住这一手里上一次不小于 3px 的增量：flatChain 只拿它比，不拿上一发比。
     * 小于 3px 的那几发不写它。
     */
    let flatBase = 0;
    /** 这一手吃下过的最大增量：回升只有不超过它的两倍才算同一手的抖动，不会越滚越大。 */
    let peak = 0;
    /** 上一发吃下时的 performance.now()：只用来量两发之间隔了多久，不用 event.timeStamp。 */
    let lastAt = 0;
    /** 上一发的 deltaMode：惯性尾巴来自同一种输入，单位和步长编码不会在半路换。 */
    let lastMode = 0;
    /**
     * 这一手里「没比上一次不小于 3px 的增量小、自己也不小于 3px」连着来了几次（第一发算一次）：
     * 严格衰减时置 1，只有开锁 / releaseLatch 才归 0。
     */
    let flatChain = 0;
    const releaseLatch = () => {
        if (!latch) return;
        window.clearTimeout(latch.timer);
        latch = null;
        previous = 0;
        flatBase = 0;
        peak = 0;
        lastAt = 0;
        lastMode = 0;
        flatChain = 0;
        window.removeEventListener('pointermove', onLatchMove, true);
    };
    const onLatchMove = (event: globalThis.PointerEvent) => {
        if (latch && Math.hypot(event.clientX - latch.x, event.clientY - latch.y) > LATCH_MOVE_PX) releaseLatch();
    };
    const holdLatch = (event: WheelEvent, magnitude: number, at: number) => {
        if (!latch) {
            latch = { timer: 0, x: event.clientX, y: event.clientY };
            window.addEventListener('pointermove', onLatchMove, true);
            // 锁从 0 起算，第一发是这一手第一次「没变小」。
            flatChain = 0;
        }
        // 小于 3px 的一发完全忽略：不计数、不清零、也不动比较基准，比较对象始终是上一次不小于 3px 的增量。
        // Magic Mouse / 精度触控板在恒定连转里会夹进 1~2px（33,2,33,2…、33,33,1,33,33,1…），以前这一发把链条
        // 归 0，那些不小于 3px 的增量永远数不到第 4 次，滚到头之后整段都是 0 推墙。它照常写 previous 和间隔。
        if (magnitude >= SEAM_WHEEL_FLAT_CHAIN_MIN_PX) {
            flatChain = magnitude < flatBase ? 1 : flatChain + 1;
            flatBase = magnitude;
        }
        previous = magnitude;
        peak = Math.max(peak, magnitude);
        lastAt = at;
        lastMode = event.deltaMode;
        window.clearTimeout(latch.timer);
        latch.timer = window.setTimeout(releaseLatch, SEAM_WHEEL_LATCH_MS);
    };
    const onWheel = (event: WheelEvent) => {
        // 墙自己的容器里的 wheel 已经归 useWallPointerPan 处理：这里第一句就退出，任何 preventDefault 都还没发生。
        if (event.target instanceof Element && event.target.closest(WALL_FIELD_SELECTOR)) return;
        // 缩放（Ctrl / ⌘ + 滚轮）与墙上一致：不拦、不推。
        if (event.ctrlKey || event.metaKey || event.defaultPrevented) return;
        const at = performance.now();
        const { dx, dy } = wallWheelDelta(event, viewportHeight());
        const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
        if (latch && magnitude > 0) {
            // 同一手势的尾巴由三条判据认，剩下的一律当新的一手：
            // 1. 比上一发小：不管隔了多久都还在同一手里。惯性尾巴每一发都比上一发小；滚轮减速的一格也变小，
            //    会被吞掉。
            if (magnitude < previous) {
                holdLatch(event, magnitude, at);
                return;
            }
            // 2. 没变小，但没超过本手峰值两倍、离上一发又不到一帧量级的间隔、还和上一发同一种单位的编码：
            //    这是惯性尾巴的相等平台期与小幅回升（合并事件会把相邻两发加起来，看着像回升）。换了一种
            //    deltaMode 就是换了来源，也不算尾巴。
            //    还要压住「同样大小连着来」的次数：滚轮一格恒定、重复，无级滚轮 / Magic Mouse 连转时的
            //    两格也能挨到一帧的间隔里，光看间隔和大小认不出来；惯性尾巴第二发就该变小，所以同一手里
            //    没比上一次不小于 3px 的增量小、自己也不小于 3px 的增量出现第 4 次时就不再当尾巴
            //    （代价见文件头「已知边界」）。
            if (
                magnitude <= peak * 2
                && at - lastAt < SEAM_WHEEL_REPEAT_GAP_MS
                && event.deltaMode === lastMode
                && flatChain < SEAM_WHEEL_FLAT_CHAIN_MAX
            ) {
                holdLatch(event, magnitude, at);
                return;
            }
            // 3. 其余都是新的一手：增量变大、在一格滚轮的间隔上重复、或者同样大小连到第 4 次，重新判边界。
            //    这样「简介滚到底再滚一格」这一格就交给墙，不必先停手 160ms。取舍：一格之后紧跟更小的一格
            //    （缩小的滚轮、按行上报的尾巴）会被当成尾巴放过，代价只是那一下不推墙，比反过来（惯性尾巴
            //    推墙）轻。
            releaseLatch();
        }
        if (seamConsumesWheel(event.target, root, dx, dy)) {
            holdLatch(event, magnitude, at);
            return;
        }
        forward(event);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
        releaseLatch();
        root.removeEventListener('wheel', onWheel);
    };
};
