import { useLayoutEffect, useState, type RefObject } from 'react';

// src/library/suites/bravais/useBravaisSeamTabsFit.ts
// 首页窄缝的页签放不放得下全名（fb2）：按测量决定，不按固定断点。
// 窄缝里「导航区」是唯一可伸缩的一段（工具格、展开按钮是自然高度）；导航区的 clientHeight 就是页头与中段此刻能用的
// 纵向空间（与页签是全名还是短形无关）。全名要多高，量的是看不见的测量副本（绝对定位、不占位、不进无障碍树）。
// ResizeObserver 只在结果变了时 setState（窗口高度、播放条安全区、账户列表开合、字体加载都会触发重量）。
// 另给出「缩成一个字也放不下、导航区在里面滚」（overflowing）：导航区底边淡出提示下面还有。
// fb2 第二轮：扩成两级。先看「带标题的全名页头」放不放得下（titled）；不行再看「不带标题的全名页头」（untitled，
// 标题视觉隐藏）；都不行才缩成一个字（short）。
// fb3：导航区分成上下两段——页头（标题、折叠、页签）贴顶，中段（扫描进度、二级切换、管理隐藏、状态、账户入口）在
// 页头与工具格之间的剩余空间里竖直居中。中段被撑到剩余高度，所以不能拿它的盒子高当内容高：量的是中段里自然高度的
// 内层（bodyRef）。二级切换也是竖排的：只有激活项显示文字，它与页签同级退让（short 时也缩成一个字），所以另有一份
// 「全名二级切换」的测量副本（fullSectionsRef；没有二级切换时是空的）。
// 放得下 = 页头副本高 + 中段内边距 + （中段内层高 − 此刻二级切换高 + 全名二级切换高）≤ 导航区高——与此刻是哪一级
// 无关，所以不会来回跳。
// fb4：账户入口挪出中段、贴在工具格上方（导航区之外的自然高度一段），平台列表往上弹出、绝对定位盖在导航区上，
// 所以列表开合不再改变任何被量的东西——页签的级别与它无关。
// 直达入口（特殊集合，二级切换下面隔一道分隔线的一列图标）：与二级切换同在中段的「切换位」（slotRef）里。退让时入口
// 先于二级切换让位：带标题 + 入口 → 不带标题 + 入口 → 不带标题、入口挪进「⋯」菜单 → 缩成一个字（入口仍在菜单里）→ 在里面滚。
// 理由：入口是捷径（集合本身在墙上、在别的 section 里都找得到），页签与二级切换是首页唯一的导航，先保住它们的全名。
// 量的是切换位的两份测量副本（全名二级切换 + 入口、全名二级切换不带入口），所需高度 = 页头副本 + 中段内边距 +
// （中段内层高 − 此刻切换位高 + 副本高）。切换位只要有二级切换或入口就一直渲染（入口挪走后可能是空的），所以中段内层的
// 段间距在各级之间不变，算出来的级别与此刻是哪一级无关，不会来回跳。
// fb11：入口改成并排的竖排文字（比图标高），并挪到中段底部单独一块（jumpsRef，贴着账户入口 / 工具格；二级切换仍在
// 中段内层里居中）。切换位只剩二级切换，测量改为：中段内层（二级切换换成全名副本）+ 入口一块的测量副本（jumpsMeasureRef，
// 含分隔线与它上面的留白；入口挪进菜单时此刻那一块是空的、高 0）。各级所需高度仍只看副本。
// 方案 C（2026-11-13）：工具格上面多了「本页」一组（目录、导入文件夹、刷新……，BravaisSeamHomeTools），它在导航区之外、
// 占掉导航区的高，所以也进这条退让的阶梯，一行一行地让：带标题 + 入口 + 本页全部 → 不带标题 + 入口 + 本页全部 →
// 不带标题 + 入口 + 本页少一行（……到一行）→ 不带标题、入口进「⋯」+ 本页全部 →（本页一行行进「⋯」）→ 缩成一个字、本页
// 全进「⋯」。本页 r 行占的高由工具格的格高、行距与本页一组下面的间距算（pageHeights），导航区可用的高按「本页一组不画」
// 折算（此刻的导航区高 + 此刻本页一组占的高），所以结果仍与此刻是哪一级无关。

/** 页头的缩减级别：带标题 + 全名 → 不带标题 + 全名 → 不带标题 + 一个字（页签与激活的二级切换一起缩）。 */
export type BravaisSeamHeadLevel = 'titled' | 'untitled' | 'short';

export type BravaisSeamTabsFit = {
    level: BravaisSeamHeadLevel;
    /** 工具格上面本页一组画几行（其余进「⋯」）。 */
    pageRows: number;
    /** 直达入口留在中段（否则挪进「⋯」菜单）。没有入口时无意义。 */
    shortcuts: boolean;
    /** 此刻的内容也放不下：导航区在里面滚。 */
    overflowing: boolean;
};

const FITS: BravaisSeamTabsFit = { level: 'titled', pageRows: Number.POSITIVE_INFINITY, shortcuts: true, overflowing: false };

/** 本页一组与下面工具格之间的间距（含分隔线），BravaisSeamHomeTools 内联在本页一组上。 */
export const BRAVAIS_PAGE_TOOLS_GAP = 15;

/**
 * 由测量值定级（纯函数）：各级所需高度只看副本，与此刻是哪一级无关。入口先于页签 / 二级切换的缩写让位（见文件头）。
 * `withShortcuts` / `withoutShortcuts` 是中段内层换成对应切换位副本后的高。
 */
export const resolveSeamTabsFit = ({
    available,
    pad,
    titledHead,
    bareHead,
    withShortcuts,
    withoutShortcuts,
    pageHeights = [0],
}: {
    /** 导航区可用的高（按本页一组不画折算）。 */
    available: number;
    pad: number;
    titledHead: number;
    bareHead: number;
    withShortcuts: number;
    withoutShortcuts: number;
    /** 本页一组画 r 行时占的高（下标是行数，[0] 是 0）；没有本页一组时只有 [0]。 */
    pageHeights?: readonly number[];
}): Pick<BravaisSeamTabsFit, 'level' | 'shortcuts' | 'pageRows'> => {
    const max = pageHeights.length - 1;
    const fits = (head: number, middle: number, rows: number) => head + pad + middle + (pageHeights[rows] ?? 0) <= available;
    if (fits(titledHead, withShortcuts, max)) return { level: 'titled', shortcuts: true, pageRows: max };
    // 入口还在时本页至少留一行（没有本页一组时就是 0 行）。
    for (let rows = max; rows >= Math.min(1, max); rows -= 1) {
        if (fits(bareHead, withShortcuts, rows)) return { level: 'untitled', shortcuts: true, pageRows: rows };
    }
    for (let rows = max; rows >= 0; rows -= 1) {
        if (fits(bareHead, withoutShortcuts, rows)) return { level: 'untitled', shortcuts: false, pageRows: rows };
    }
    return { level: 'short', shortcuts: false, pageRows: 0 };
};

/** 元素的上下内边距之和。 */
const paddingBlock = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
};

export const useBravaisSeamTabsFit = ({
    navRef,
    headRef,
    middleRef,
    bodyRef,
    slotRef,
    titledHeadRef,
    bareHeadRef,
    fullSlotRef,
    jumpsRef,
    jumpsMeasureRef,
    pageCells = 0,
    pageColumns = 2,
}: {
    /** 可伸缩的导航区（flex 剩余空间，溢出时可滚）。 */
    navRef: RefObject<HTMLElement | null>;
    /** 此刻渲染的页头（标题 + 折叠 + 页签）。 */
    headRef: RefObject<HTMLElement | null>;
    /** 中段（撑满页头下面的剩余空间，内容竖直居中；上下内边距是它与页头、工具格的间距）。 */
    middleRef: RefObject<HTMLElement | null>;
    /** 中段里自然高度的内层。 */
    bodyRef: RefObject<HTMLElement | null>;
    /** 此刻渲染的切换位：二级切换（没有时为 null）。 */
    slotRef: RefObject<HTMLElement | null>;
    /** 带标题的全名页头的测量副本。 */
    titledHeadRef: RefObject<HTMLElement | null>;
    /** 不带标题的全名页头的测量副本。 */
    bareHeadRef: RefObject<HTMLElement | null>;
    /** 切换位的测量副本：全名二级切换（容器常在，没有时是空的）。 */
    fullSlotRef: RefObject<HTMLElement | null>;
    /** 此刻中段底部的直达入口一块（入口挪进菜单或没有入口时是空的）。 */
    jumpsRef: RefObject<HTMLElement | null>;
    /** 直达入口一块的测量副本（容器常在，没有入口时是空的）。 */
    jumpsMeasureRef: RefObject<HTMLElement | null>;
    /** 本页一组最多几格（候选数与上限取小）、几列。 */
    pageCells?: number;
    pageColumns?: number;
}): BravaisSeamTabsFit => {
    const [fit, setFit] = useState<BravaisSeamTabsFit>(FITS);

    useLayoutEffect(() => {
        const nav = navRef.current;
        const head = headRef.current;
        const middle = middleRef.current;
        const body = bodyRef.current;
        const titledHead = titledHeadRef.current;
        const bareHead = bareHeadRef.current;
        const fullSlot = fullSlotRef.current;
        const jumps = jumpsRef.current;
        const jumpsMeasure = jumpsMeasureRef.current;
        if (!nav || !head || !middle || !body || !titledHead || !bareHead || !fullSlot || !jumps || !jumpsMeasure || typeof ResizeObserver === 'undefined') return undefined;
        const root = nav.parentElement;
        const measure = () => {
            // 本页一组：格高与行距取工具格（app 级那一格常在），此刻画着的本页一组的高折回可用高里。
            const tools = root?.querySelector<HTMLElement>('.bravais-seam-tools:not(.is-page)');
            const page = root?.querySelector<HTMLElement>('.bravais-seam-tools.is-page');
            const cell = (tools?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
            const rowGap = tools ? parseFloat(getComputedStyle(tools).rowGap) || 0 : 0;
            const maxRows = cell > 0 ? Math.ceil(pageCells / Math.max(1, pageColumns)) : 0;
            const pageHeights = Array.from({ length: maxRows + 1 }, (_, rows) => (rows === 0 ? 0 : rows * cell + (rows - 1) * rowGap + BRAVAIS_PAGE_TOOLS_GAP));
            const available = nav.clientHeight + (page ? page.offsetHeight + BRAVAIS_PAGE_TOOLS_GAP : 0) + 0.5;
            const pad = paddingBlock(middle);
            // 中段内层的二级切换换成全名副本；入口一块按副本加或不加。
            const rest = body.offsetHeight - (slotRef.current?.offsetHeight ?? 0) + fullSlot.offsetHeight;
            const { level, shortcuts, pageRows } = resolveSeamTabsFit({
                available,
                pad,
                titledHead: titledHead.offsetHeight,
                bareHead: bareHead.offsetHeight,
                withShortcuts: rest + jumpsMeasure.offsetHeight,
                withoutShortcuts: rest,
                pageHeights,
            });
            const overflowing = head.offsetHeight + pad + body.offsetHeight + jumps.offsetHeight > nav.clientHeight + 0.5;
            setFit(current => (
                current.level === level && current.shortcuts === shortcuts && current.pageRows === pageRows && current.overflowing === overflowing
                    ? current
                    : { level, shortcuts, pageRows, overflowing }
            ));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(nav);
        observer.observe(head);
        observer.observe(body);
        observer.observe(titledHead);
        observer.observe(bareHead);
        observer.observe(fullSlot);
        observer.observe(jumps);
        observer.observe(jumpsMeasure);
        return () => observer.disconnect();
    }, [bareHeadRef, bodyRef, fullSlotRef, headRef, jumpsMeasureRef, jumpsRef, middleRef, navRef, pageCells, pageColumns, slotRef, titledHeadRef]);

    return fit;
};
