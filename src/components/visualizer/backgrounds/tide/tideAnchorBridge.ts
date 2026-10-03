// src/components/visualizer/backgrounds/tide/tideAnchorBridge.ts
//
// canvas 类可视化（商籁 / 绘光）把自己的逐字位置发布到这里，tide 在取样时读取。
//
// 存在的理由：这两个模式把歌词画在 Pixi/WebGL 画布内，DOM 里没有字形，而 tide 的字形采集
// 明确跳过 canvas 子树 —— 它们对 tide 完全不可见，只能退化成时序合成锚点，水面于是和字
// 毫无关系。这条桥让它们把自己的位置主动报出来。
//
// 按舞台实例隔离：主舞台与样式预览各自持有自己的 Pixi 画布，各画布一份独立的锚点帧 ——
// 互不覆盖；读取方按「画布是否在自己这棵舞台子树里」认领属于自己的那一份。画布脱离文档
// （预览关闭、模式卸载）的帧在读取时被剪除，因此不存在指向已卸载画布的残留引用。
//
// 约定：x / y 是**画布逻辑像素**（原点在画布左上、y 向下），strength 是该字当前的活跃度
// （0..1，通常取它当帧的实际 alpha）。tide 侧只用画布的 CSS rect 折算到舞台坐标，
// 因此与 DPR、画布在舞台里的偏移都无关。

export interface TideBridgeAnchor {
    x: number;
    y: number;
    strength: number;
}

export interface TideBridgeFrame {
    canvas: HTMLCanvasElement;
    count: number;
    anchors: readonly TideBridgeAnchor[];
}

/** 一帧最多发布多少个逐字锚点。真实需求远小于此，纯粹防失控。 */
const MAX_BRIDGE_ANCHORS = 512;

interface TideBridgeFrameState {
    canvas: HTMLCanvasElement;
    count: number;
    /** 预分配槽位：每帧只是覆写数字，不产生任何临时对象。 */
    anchors: TideBridgeAnchor[];
}

const createFrameState = (canvas: HTMLCanvasElement): TideBridgeFrameState => {
    const anchors: TideBridgeAnchor[] = [];
    for (let index = 0; index < MAX_BRIDGE_ANCHORS; index += 1) {
        anchors.push({ x: 0, y: 0, strength: 0 });
    }
    return { canvas, count: 0, anchors };
};

/** 每个画布一份帧状态：主舞台与预览互不覆盖，卸载的画布各自回收。 */
const frames = new Map<HTMLCanvasElement, TideBridgeFrameState>();

/**
 * 正在发布的那一份帧。begin 时登记，发布在**同一个同步渲染回调**内完成
 * （renderFrame → beginTideAnchors → publishTideAnchorFrom 全部同步），不会跨帧残留。
 */
let active: TideBridgeFrameState | null = null;

/**
 * 每帧开头调用一次（由模式自己的 renderFrame 调），重开该画布本帧的锚点列表。
 * 传入自己的画布：这是「按舞台实例隔离」的登记点。
 */
export const beginTideAnchors = (canvas: HTMLCanvasElement | null): void => {
    if (!canvas) {
        active = null;
        return;
    }

    let frame = frames.get(canvas);
    if (!frame) {
        frame = createFrameState(canvas);
        frames.set(canvas, frame);
    }
    frame.count = 0;
    active = frame;
};

/** 发布一个逐字锚点：画布逻辑像素 + 该字当前的活跃度。没有活动帧时静默丢弃。 */
export const pushTideAnchor = (x: number, y: number, strength: number): void => {
    if (!active || active.count >= MAX_BRIDGE_ANCHORS) {
        return;
    }

    const slot = active.anchors[active.count];
    slot.x = x;
    slot.y = y;
    slot.strength = strength;
    active.count += 1;
};

/** 某个字形容器的最小契约：只要能把「自己在屏幕上的位置」答出来就行。 */
export interface TideAnchorTarget {
    getGlobalPosition?: () => { x: number; y: number };
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** 字还没开始唱 / 已经唱完之后，锚点强度按这两段时间淡入淡出（秒）。 */
export const GLYPH_ANCHOR_LEAD = 0.18;
export const GLYPH_ANCHOR_TAIL = 0.35;

/**
 * 锚点强度 = 这个字**此刻活着**的程度，与文字模式的 envelopeOf 同一形状：
 * 字自己的时段内为 1，时段外按前导/拖尾淡出。
 *
 * 这里**不能**用该字的 alpha：alpha 唱完就停在 1，于是「只留最亮的若干个」在一行长句
 * （或商籁一个 shot 覆盖整段）里永远挑中排在最前面那几个字，水面钉在行首不跟着唱。
 */
export const resolveGlyphAnchorStrength = (time: number, start: number, end: number): number => {
    if (time < start) {
        return clamp01(1 - (start - time) / GLYPH_ANCHOR_LEAD);
    }

    if (time > end) {
        return clamp01(1 - (time - end) / GLYPH_ANCHOR_TAIL);
    }

    return 1;
};

/**
 * 从一个 Pixi 字形容器发布锚点。
 * 防御式：拿不到全局位置（桩对象、已销毁的节点）或强度≈0（未唱/未亮起）时直接跳过 ——
 * 这条桥永远不该让渲染层崩掉。
 */
export const publishTideAnchorFrom = (target: TideAnchorTarget | null, strength: number): void => {
    if (!target || typeof target.getGlobalPosition !== 'function' || !(strength > 0.02)) {
        return;
    }

    const global = target.getGlobalPosition();
    pushTideAnchor(global.x, global.y, strength);
};

/** 模式销毁时交还自己的帧：预览关闭后不留残留，主舞台读取不受影响。 */
export const releaseTideAnchorCanvas = (canvas: HTMLCanvasElement | null): void => {
    if (!canvas) {
        return;
    }

    frames.delete(canvas);
    if (active?.canvas === canvas) {
        active = null;
    }
};

/** 全量清空（测试 / 整层下线用）。 */
export const clearTideAnchors = (): void => {
    frames.clear();
    active = null;
};

/**
 * 读取属于这个舞台的那一帧逐字锚点：画布必须仍在文档里、且长在 stage 这棵子树内。
 * 没有可用的就返回 null，调用方自然走原有路径。顺带剪除已脱离文档的画布
 * （预览关闭、模式卸载），所以不存在读到已卸载画布的位置这回事。
 */
export const readTideAnchors = (stage: HTMLElement | null): TideBridgeFrame | null => {
    if (!stage) {
        return null;
    }

    let found: TideBridgeFrameState | null = null;
    for (const frame of frames.values()) {
        if (!frame.canvas.isConnected) {
            frames.delete(frame.canvas);
            continue;
        }

        // 只认领长在自己这棵舞台子树里的画布：主舞台与样式预览各取各的，互不串台。
        if (frame.count > 0 && stage.contains(frame.canvas)) {
            found = frame;
            break;
        }
    }

    return found ? { canvas: found.canvas, count: found.count, anchors: found.anchors } : null;
};
