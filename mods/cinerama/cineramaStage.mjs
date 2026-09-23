// mods/cinerama/cineramaStage.mjs
// The "hardware": the LED wall that covers the whole stage — screen surface,
// scanlines and the safe area the lyrics live in. Purely static chrome:
// every per-frame write goes to textHost, never to this subtree.
//
// 屏面跟**主题的亮 / 暗**走：屏面取主题的背景色，再往「另一侧」推一点
// （暗色主题提亮、亮色主题压暗，于是既跟主题走又读得出是一面贴上去的屏），
// 屏上的文字就用主题自己的文字色——那一对本来就是配着用的。
// 以前屏面是一层固定的半透明黑：浅色主题下它压在浅色背景上，整块变成一片
// 「既不是墙也不是宿主背景」的浅灰；
// 而改全不透明又会在浅色主题下变成一块黑墙（同一件事的另一头）。

/*
 * 主题是亮还是暗。主题色是任意格式的 CSS 字符串，模组侧解析不了亮度，
 * 所以让浏览器解析一次：把颜色写到一个临时探针上再读回计算值（`rgb(r, g, b)`）。
 * 探针挂在**调用方给的节点**里（模组自己的 DOM），读完立刻摘掉——不碰宿主的其它节点。
 * 读不到返回 null，调用方按「暗色」处理（屏面 = 主题背景色，最坏只是少一点层次）。
 */
const readThemeIsDark = (theme, host) => {
    try {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;';
        probe.style.color = theme?.backgroundColor ?? '#0a0a0f';
        (host ?? document.body).append(probe);
        const computed = typeof getComputedStyle === 'function' ? getComputedStyle(probe).color : '';
        probe.remove();
        const rgb = (computed.match(/[\d.]+/g) ?? []).map(Number);
        if (rgb.length >= 3) {
            // 感知亮度（sRGB 加权近似）：0 全黑、1 全白。
            return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 < 0.5;
        }
    } catch {
        // 读不到就退回暗色：屏面仍然等于主题背景色，不会出错，只是层次弱一点。
    }
    return null;
};

/*
 * 屏面的每一处颜色都从主题派生（`color-mix` 让浏览器做 alpha 化——主题色是任意
 * 格式的 CSS 字符串，模组侧做不了可靠的透明化）。哪天主题色统一成可解析色值，
 * 这里可以换成自己算。
 */
export const resolveCineramaPalette = (theme, host) => {
    const themeText = theme?.primaryColor ?? '#f5f7ff';
    const surface = theme?.backgroundColor ?? '#0a0a0f';
    const isDark = readThemeIsDark(theme, host) !== false;
    // 暗色主题把屏面提亮、亮色主题把屏面压暗：屏面因此始终比宿主背景「更实」一点。
    const toward = isDark ? '#ffffff' : '#000000';
    return {
        primary: themeText,
        accent: theme?.accentColor ?? '#8fc7ff',
        secondary: theme?.secondaryColor ?? '#6f8cff',
        background: surface,
        /*
         * 屏面上**正文**的颜色走 `accent`（主题强调色），不在这里派生：
         * 小字报 / 大字报 / 跑马灯带上的字都用它（见 cineramaRender 的 skinOf）。
         * 这一项（主题文字色）现在只剩一个用处——解算失败时的**兜底正文层**
         * （见 visualizer.mjs 的 buildFallbackLayer）。跑马灯带的区域底改成强调色的极淡底、
         * 边线走 `accent`（辉光档）或 `secondary`（实线档），不再取中性色
         * （见 cineramaRender 的 bandTintDeclarations / bandEdgeDeclarations）。
         */
        screenText: themeText,
        screenTop: `color-mix(in srgb, ${surface} 92%, ${toward})`,
        screenBottom: `color-mix(in srgb, ${surface} 84%, ${toward})`,
        // 扫描线与暗角取文字色的一侧：亮色主题下是深色纹理，暗色主题下是浅色纹理。
        screenLine: `color-mix(in srgb, ${themeText} 8%, transparent)`,
        screenShade: `color-mix(in srgb, ${themeText} 16%, transparent)`,
        dark: isDark,
        fontWeight: theme?.fontWeight ?? 600,
        fontFamily: Array.isArray(theme?.fontFamilyStack) && theme.fontFamilyStack.length > 0
            ? theme.fontFamilyStack.join(', ')
            : (theme?.fontFamily ?? 'inherit'),
    };
};

const createLayer = (cssText) => {
    const layer = document.createElement('div');
    layer.style.cssText = cssText;
    return layer;
};

// 屏面三处颜色（surface / 扫描线 / 暗角）都是从主题算出来的，切换主题时整块重刷。
const chromeStyles = (palette) => ({
    screen: `background:linear-gradient(180deg, ${palette.screenTop}, ${palette.screenBottom})`,
    scanlines: `background:repeating-linear-gradient(to bottom, ${palette.screenLine} 0px, ${palette.screenLine} 1px, transparent 1px, transparent 3px)`,
    vignette: `box-shadow:inset 0 0 150px ${palette.screenShade}`,
});

/*
 * Builds the screen subtree inside `element`. Returns the text host the
 * painter drives, plus an `applyPalette` for live theme switches and a
 * disposer that detaches everything.
 *
 * 屏体**铺满整个舞台**（`inset:0`）：以前是居中一块 92%×56% 的圆角屏，于是屏外露出
 * 一圈底色、屏沿还有外投影 + 2px 内描边 + 强暗角——在浅色主题下那一圈就读成「黑框」，
 * 而且屏体本身没把舞台填满。屏面因此不再有边框/圆角/投影；斜向眩光也去掉了，
 * 那是给一块居中面板做的受光，铺满之后会变成横跨整个画面的一道浅色。
 *
 * `transparentSurface` 为真时**不建屏面、不建扫描线与暗角**：宿主给的已经是透明
 * 表面（播放页透明 / OBS 源 / 导出窗口），一块不透明的墙会把整帧变成实心矩形。
 * text host 仍然建（它自己没有背景），文字靠自己的 text-shadow 保证可读。
 *
 * `hostBackground` 为真时宿主已经在模组后面画了「背景类型」定义的背景（模组侧判据见
 * `hostPanel.hasCineramaHostBackground`）：这时**屏面的填充让位**，只留下扫描线与暗角
 * ——它们是 alpha 纹理，不挡底下的背景，又是「巨幕」自己的画面语汇。屏面让位不重建 DOM，
 * 只换一条 background 声明，所以用户改「背景类型」时逐帧就能跟上（`applyScreenFill`）。
 */
export const createCineramaStage = (element, palette, { transparentSurface = false, hostBackground = false } = {}) => {
    const root = createLayer([
        'position:absolute', 'inset:0',
        'overflow:hidden', 'pointer-events:none',
    ].join(';'));

    const screen = createLayer([
        'position:absolute', 'inset:0', 'overflow:hidden',
        /*
         * 屏体是一个 **size container**：屏内的尺寸因此有了一套真正的「屏体百分比」
         * （1cqh = 屏高的 1%、1cqw = 屏宽的 1%）。跑马灯带的带高是屏高的 12%，
         * 带内字号就必须也用 cqh 写——用 vh 写的是视口高度，两者只在
         * 「屏体 = 整个舞台」时才相等，字一旦比带子高就会被裁掉。
         */
        'container-type:size',
    ].join(';'));

    const scanlines = createLayer(['position:absolute', 'inset:0', 'opacity:0.5'].join(';'));

    const vignette = createLayer(['position:absolute', 'inset:0'].join(';'));

    // 内容层的挂载点：不带任何字体/颜色/阴影——那些由 cineramaRender 的每一层
    // 自己声明，否则丝带这类不写 text-shadow 的层会继承到文字辉光。
    const textHost = createLayer([
        'position:absolute', 'inset:0',
        'display:block', 'box-sizing:border-box',
        'will-change:transform,opacity',
    ].join(';'));

    /*
     * 主题切换时重刷屏面：mount 不会因为换主题重跑（宿主的 mount 依赖只跟歌词走），
     * 所以颜色不能只在建层那一刻写一次。
     */
    let currentPalette = palette;
    let fillVisible = !hostBackground;

    const applyPalette = (next) => {
        currentPalette = next;
        const chrome = chromeStyles(currentPalette);
        screen.style.background = fillVisible ? chrome.screen : 'transparent';
        scanlines.style.background = chrome.scanlines;
        vignette.style.boxShadow = chrome.vignette;
    };

    /*
     * 屏面填充开关：宿主背景出现 / 消失（用户在设置里换「背景类型」）时切换。
     * 只换一条声明，不重建子树——textHost 上挂着正在放的内容层，重建会把它们一起拆掉。
     */
    const applyScreenFill = (visible) => {
        if (visible === fillVisible) return;
        fillVisible = visible;
        screen.style.background = fillVisible ? chromeStyles(currentPalette).screen : 'transparent';
    };

    applyPalette(palette);
    // 透明表面：屏面与它的两层 chrome 都不建，只留内容层。
    if (transparentSurface) {
        root.append(textHost);
        element.append(root);
        return {
            root,
            screen: null,
            textHost,
            applyPalette: () => {},
            applyScreenFill: () => {},
            dispose: () => root.remove(),
        };
    }
    screen.append(scanlines, vignette, textHost);
    root.append(screen);
    element.append(root);

    return {
        root,
        screen,
        textHost,
        applyPalette,
        applyScreenFill,
        dispose: () => root.remove(),
    };
};
