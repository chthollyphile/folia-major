import { resolveCineramaOptions } from './cineramaOptions.mjs';
import { getCineramaSettings } from './cineramaSettings.mjs';

// mods/cinerama/hostPanel.mjs
// 模组自带的宿主接入层。巨幕的设置面板要和**其它歌词动画的细节设置面板**待在同一个位置：
// 动画模式选择器那张卡片的下一个兄弟位（宿主把内置模式的 `renderSettingsPanel` 渲染在那里）。
//
// 定位靠一条显式锚点：宿主在模式选择器那张卡片里渲染
//
//     <div data-mod-visualizer-settings-slot="<当前 mode id>">
//
// （src/components/visualizer/ModVisualizerSettingsSlot.tsx，宿主对模组的唯一 DOM 契约）。
// 锚点有两个用途：属性值是当前 mode id，用来判定「当前模式是不是巨幕」（与语言、皮肤无关）；
// 从它往上 `closest('rounded-[24px]')` 找到设置卡片，面板插到卡片后面。
//
// 锚点就是唯一的一条路：它没有第二条回退。以前这里还有一套「按选择器文案找卡片」的
// 启发式，而它依赖的 `data-preset-group-label` 宿主侧从来没渲染过（`PresetGroup` 只输出
// className/style），于是那条路恒为 null——走进去既挂不上、又每 400ms 把面板摘一次。
// 锚点缺席（旧宿主）的正确结果是**面板不出现**：宿主重绘随时会删掉手插节点，靠猜位置
// 插进去也只是多一次摘挂循环。卡片定位不到时退回把面板放进锚点；锚点也没有就不挂，不抛错。
//
// 宿主重绘（切分区、改主题）会删掉插入的节点，所以用轮询补挂。
//
// 隔离：插入的节点带 `data-cinerama-panel` 标记，只读写巨幕自己那几个 key，不碰宿主 DOM
// 的其他部分；所有 DOM / store 交互都包在 try 里——宿主内部结构对模组不是契约，换版本后
// 失效必须是「面板不出现」，不能是「应用炸掉」。

export const PANEL_ATTRIBUTE = 'data-cinerama-panel';
export const SLOT_ATTRIBUTE = 'data-mod-visualizer-settings-slot';
const CARD_BORDER_CLASS = 'rounded-[24px]';

/*
 * 读宿主的锚点。返回 `{ slot, mode }`：mode 是属性值（当前模式 id，锚点存在时一定有值，
 * 空串说明宿主没填，此时不做模式判定）；没有锚点时返回 null，调用方退回启发式。
 */
export const findCineramaSettingsSlot = () => {
    try {
        const slot = document.querySelector(`[${SLOT_ATTRIBUTE}]`);
        if (!slot) return null;
        return { slot, mode: slot.getAttribute(SLOT_ATTRIBUTE) ?? '' };
    } catch {
        return null;
    }
};

/*
 * 当前歌词动画模式是不是巨幕。
 *
 * 只看锚点的 mode id：不依赖文案、不依赖语言，也不受宿主换皮肤影响。锚点缺席（旧宿主）
 * 一律判「不是」——没有第二条路。
 *
 * 判不出来一律返回 false，和「宁可多显示」相反：面板是模组手动插进宿主 DOM 的
 * 非受控节点，切到通用/背景分区后锚点整块消失，宿主不会替我们收走它，此时若判成
 * 「显示」，巨幕设置就会挂在别人的分区里不消失。判成隐藏最坏只是面板不出现，
 * 而且 400ms 后 keepAlive 会重新判一次。
 */
export const isCineramaModeActive = (modeId) => {
    const slot = findCineramaSettingsSlot();
    if (!slot) return false;
    // 空串按「判不出来」处理：与上面的注释一致，宁可隐藏也不要挂在无关分区里。
    if (!slot.mode) return false;
    return Boolean(modeId) && slot.mode === modeId;
};

// Tailwind 的 `rounded-[24px]` 在 CSS 选择器里要转义方括号。
const CSS_CLASS_ESCAPE = (className) => className.replace(/([[\]])/g, '\\$1');

/*
 * 从锚点往上找那张设置卡片（宿主给设置卡片统一加了 `rounded-[24px]`）。
 * 找不到返回 null——宿主换布局是常态，定位失败必须能降级。
 */
const findAnchorCard = () => {
    const slot = findCineramaSettingsSlot();
    if (!slot) return null;
    try {
        return slot.slot.closest(`.${CSS_CLASS_ESCAPE(CARD_BORDER_CLASS)}`) ?? slot.slot.parentElement ?? null;
    } catch {
        return null;
    }
};

/*
 * 把面板挂到**模式选择器卡片的下一个兄弟位**——也就是宿主渲染其它歌词动画
 * 细节设置面板（`renderSettingsPanel`）的同一个位置。
 *
 * 之前挂在锚点**内部**（锚点在模式选择器卡片里），面板因此是「卡片里套一块」：
 * 圆角、内边距、与上下卡片的留白都和内置模式的设置卡片对不上。改挂到卡片外面
 * 之后，巨幕这块和内置那几块是同一个父节点下的兄弟，外观只取决于面板自己的样式。
 *
 * 锚点仍然有用，只是不再当容器：它的属性值是当前 mode id，是判定「当前模式是
 * 不是巨幕」最可靠的依据（与语言、皮肤、按钮文案无关）。
 *
 * 卡片定位不到时退回把面板放进锚点——宁可位置差一点，也不要面板不出现。
 * 锚点也没有时**把面板摘下来**：宿主切到通用/背景分区后这张卡片整块消失，而面板是
 * 手动插进 DOM 的，宿主不会替我们收走它，留着就会挂在别人的分区里。摘下来不丢状态，
 * 回到歌词动画分区后 400ms 内会被重新插上（见 createCineramaPanelKeepAlive）。
 */
export const mountCineramaPanel = (panelElement) => {
    if (!panelElement) return false;
    const card = findAnchorCard();
    const container = card?.parentElement ?? null;
    if (!card || !container) {
        if (mountIntoSlot(panelElement)) return true;
        detachPanel(panelElement);
        return false;
    }
    try {
        /*
         * 幂等：已经在卡片的下一个兄弟位就不动它（否则每次轮询都会把它挪到怪位置）。
         *
         * `children` 是 **HTMLCollection**，没有 `indexOf`——直接 `.indexOf(card)`
         * 会抛 TypeError，而且它在 try 之外时，异常会中断整个 tick（`onMount` 因此
         * 再也跑不到，切到别的歌词动画时面板不会隐藏）。所以用数组的那一版来查下标。
         */
        const nextSibling = Array.prototype.indexOf.call(container.children, card) + 1;
        if (panelElement.parentElement === container && container.children[nextSibling] === panelElement) {
            return true;
        }
        panelElement.setAttribute(PANEL_ATTRIBUTE, 'settings');
        container.insertBefore(panelElement, card.nextSibling);
        return panelElement.isConnected;
    } catch {
        return false;
    }
};

// 兜底：卡片定位不到时把面板直接塞进锚点（宿主契约节点），总比不出现好。
const mountIntoSlot = (panelElement) => {
    const slot = findCineramaSettingsSlot();
    if (!slot) return false;
    if (panelElement.parentElement === slot.slot) return true;
    try {
        panelElement.setAttribute(PANEL_ATTRIBUTE, 'settings');
        slot.slot.appendChild(panelElement);
        return panelElement.isConnected;
    } catch {
        return false;
    }
};

// 把面板从当前位置摘下来（宿主已经不在歌词动画这一屏了）。面板对象本身保留，可再插回。
const detachPanel = (panelElement) => {
    try {
        if (panelElement.isConnected) panelElement.remove();
    } catch {
        // 节点已经被宿主清掉了：无事可做。
    }
};

/*
 * 页面在后台时停轮询：设置界面与播放页同开时，这个定时器每 400ms 要全文档查一次锚点，
 * 而页面不可见时宿主既不会重绘、用户也看不到补挂结果，纯属白跑。
 * 回到前台立刻补一轮（顺便把「离开期间宿主重绘过」这一次补上）。
 */
const isDocumentHidden = () => {
    try {
        return typeof document !== 'undefined' && document.visibilityState === 'hidden';
    } catch {
        return false;
    }
};

/*
 * 常驻挂载：宿主重绘会删掉插入的节点，所以定期检查补挂。
 * `onMount` 在每轮尝试后回调（拿到本轮是否挂上），调用方用它同步可见性——
 * 与挂载同一个节奏，切回歌词动画分区时不会先空白一拍。
 * 页面不可见时整个定时器停掉（见 isDocumentHidden），回前台再起。
 * 返回 dispose；dispose 后不再补挂，也不再被 visibilitychange 唤醒，并移除自己插的节点。
 *
 * 频率分两档（见 PANEL_DUE_INTERVAL_MS）：面板**该在这一屏**时才用 intervalMs 快轮询——
 * 那一刻宿主随时可能重绘把手插节点删掉，补挂慢了就是一段空白；不该在这一屏时（当前模式
 * 不是巨幕、或宿主根本没渲染锚点）降到慢档，那时只是在等宿主切回来，快轮询纯属白跑。
 * 慢档不是停：停了就再也发现不了锚点回来，而宿主没有给我们别的通知渠道。
 *
 * @param {{ intervalMs?: number, modeId?: string, onMount?: (mounted: boolean) => void }} [options]
 */
const PANEL_DUE_INTERVAL_MS = 400;
// 不该在这一屏时的等待档：只看锚点有没有回来，不需要跟上宿主重绘。
const PANEL_IDLE_INTERVAL_MS = 2000;

export const createCineramaPanelKeepAlive = (panelElement, options) => {
    const { intervalMs = PANEL_DUE_INTERVAL_MS, modeId = '', onMount } = options ?? {};
    let handle = null;
    let disposed = false;
    const tick = () => {
        const mounted = mountCineramaPanel(panelElement);
        if (typeof onMount === 'function') onMount(mounted);
    };
    // 锚点在 + 当前模式是巨幕才走快档；`modeId` 缺席时只看锚点在不在。
    const nextDelay = () => (Boolean(findCineramaSettingsSlot()) && (modeId ? isCineramaModeActive(modeId) : true)
        ? intervalMs
        : PANEL_IDLE_INTERVAL_MS);
    const schedule = () => {
        if (disposed || handle !== null || isDocumentHidden()) return;
        handle = setTimeout(() => {
            handle = null;
            tick();
            schedule();
        }, nextDelay());
    };
    const start = () => {
        if (disposed || handle !== null || isDocumentHidden()) return;
        tick();
        schedule();
    };
    const stop = () => {
        if (handle === null) return;
        clearTimeout(handle);
        handle = null;
    };
    tick();
    schedule();
    const onVisibilityChange = () => {
        if (isDocumentHidden()) {
            stop();
            return;
        }
        start();
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
        disposed = true;
        stop();
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibilityChange);
        }
        try {
            if (panelElement.isConnected) panelElement.remove();
        } catch {
            // 节点已经被宿主清掉了：无事可做。
        }
    };
};

/*
 * 设置值的合并顺序（后者盖前者）：巨幕自带面板的共享值 → 调制通道（实时旋钮，最高优先级）。
 *
 * 自带面板的值必须参与合并，否则面板能拖、画面不动：它写的是模组自己的单例，
 * 不是宿主的 store。
 *
 * 这里刻意**不**读 `props.getSettings()`：巨幕不声明 manifest 的 `visualizers[].settings`
 * （宿主会照它再渲染一组同样的旋钮），那条通道里只剩旧版本留下的值，合并进来会让
 * 「面板上显示的数」和「画面实际用的数」对不上。哪天把 schema 交回宿主渲染，
 * 在这里加回 `props.getSettings()` 即可。
 *
 * 返回的是**解析后**的完整旋钮集，缺席的来源全部回落缺省，所以导出窗口、旧宿主下
 * 画面恒等于静态常量。
 */
/*
 * 画面宽高比：几何解算要它（大字报的横向可用宽度按它折算），但它是**环境量**不是旋钮，
 * 所以不走设置面板，而是每帧从宿主容器量。量不到（导出窗口、离屏缩略图、容器尺寸为 0）
 * 返回 null，解析层会回落 16:9——几何里出现 NaN 会让整层塌掉，宁可给一个常见比例。
 */
export const readCineramaViewportAspect = (element) => {
    try {
        const width = element?.clientWidth ?? 0;
        const height = element?.clientHeight ?? 0;
        if (!(width > 0) || !(height > 0)) return null;
        return width / height;
    } catch {
        return null;
    }
};

/*
 * 宿主是不是已经在模组后面画了「背景类型」定义的背景。
 *
 * 与内置模式同源：内置 renderer 读的是 `props.background`（整份配置），模组这一侧同样
 * 拿到整份配置，怎么叠由模组自己决定。判据只有一条——`transparent` 为真表示宿主给的
 * 是**透明表面**（播放页透明 / OBS 浏览器源 / 模组导出窗口），那时没有可透出的背景，
 * 屏面本来就不该画（见 `createCineramaStage` 的 `transparentSurface`）。
 *
 * 宿主没传 `background`（旧宿主、旧导出配置）时返回 false：模组维持原行为，自己画屏面。
 * 宁可多画一层墙，也不要在一块空表面上把画面交出去。
 */
export const hasCineramaHostBackground = (props) => {
    const background = props?.background;
    if (!background || typeof background !== 'object') return false;
    return background.transparent !== true;
};

/*
 * @param viewportAspect 舞台宽高比（null = 量不到，解析层回落 16:9）。
 * @param stageMetrics 周期要的环境量（渲染层的 `readBandStageMetrics` 结果）；它是**读数**
 *   不是旋钮，所以不落盘、不进签名，只随这一帧的快照下发。
 */
export const resolveCineramaKnobs = (props, { viewportAspect = null, stageMetrics = null } = {}) => {
    const fromModulation = typeof props?.getModulation === 'function' ? props.getModulation() : undefined;
    // 环境量盖在调制之上：它不是用户能调的东西，modulation 里带了也以实测为准。
    const live = { ...(fromModulation ?? {}) };
    if (viewportAspect !== null) live.viewportAspect = viewportAspect;
    if (stageMetrics) live.stageMetrics = stageMetrics;
    return resolveCineramaOptions(getCineramaSettings(), live);
};
