import { useLayoutEffect, useState, type RefObject } from 'react';
import type { BravaisSeamTabsFit } from './useBravaisSeamTabsFit';

// src/library/suites/bravais/useBravaisSeamRowFit.ts
// 信息条横向时首页横条（BravaisSeamHomeRow）放不放得下：与竖的窄缝（useBravaisSeamTabsFit）同一套退让顺序，量的是宽度。
// 横条里只有「导航段」（「书库」、页签、扫描进度、二级切换、直达入口、管理隐藏、状态）与账户入口会随级别变宽变窄；
// 折叠、过滤位、工具格、展开按钮是自然宽度。退让：带「书库」→ 不带 → 直达入口挪进「⋯」→ 账户入口只留头像 → 页签与
// 激活的二级切换缩成一个字 → 还放不下，导航段在里面横向滚（overflowing）。账户名先于页签让位：页签是首页的导航，名字在
// 头像的 title / aria-label 里仍在。
// 各级要多宽量的是看不见的测量副本（与导航段同一身样式，width: max-content）；扫描进度、管理隐藏、状态不随级别变，量
// 此刻的（data-bravais-row-extra）。可用宽度 = 横条内容宽 − 其余各段 − 段间距，与此刻是哪一级无关，所以不会来回跳。

/** 横条的退让结果：竖的窄缝那三项，加上账户入口是否只留头像。 */
export type BravaisSeamRowFit = BravaisSeamTabsFit & { accountCompact: boolean };

/** 各级导航段测量副本的宽度（不含扫描进度、管理隐藏、状态）。 */
export type BravaisSeamRowWidths = {
    titled: number;
    untitled: number;
    noShortcuts: number;
    short: number;
};

/** 由测量值定级（纯函数）：第一个放得下的级别；都放不下时取最窄的一级并在导航段里滚。 */
export const resolveSeamRowFit = ({
    available,
    extras,
    nav,
    account,
}: {
    /** 导航段与账户入口一共能用的宽度。 */
    available: number;
    /** 扫描进度、管理隐藏、状态（含它们前面的段间距）。 */
    extras: number;
    nav: BravaisSeamRowWidths;
    /** 账户入口带名字 / 只留头像的宽度（没有账户入口时都是 0）。 */
    account: { full: number; compact: number };
}): BravaisSeamRowFit => {
    const fits = (width: number, accountWidth: number) => width + extras + accountWidth <= available + 0.5;
    if (fits(nav.titled, account.full)) return { level: 'titled', shortcuts: true, accountCompact: false, overflowing: false };
    if (fits(nav.untitled, account.full)) return { level: 'untitled', shortcuts: true, accountCompact: false, overflowing: false };
    if (fits(nav.noShortcuts, account.full)) return { level: 'untitled', shortcuts: false, accountCompact: false, overflowing: false };
    if (fits(nav.noShortcuts, account.compact)) return { level: 'untitled', shortcuts: false, accountCompact: true, overflowing: false };
    return { level: 'short', shortcuts: false, accountCompact: true, overflowing: !fits(nav.short, account.compact) };
};

const FITS: BravaisSeamRowFit = { level: 'titled', shortcuts: true, accountCompact: false, overflowing: false };

const widthOf = (element: Element | null) => (element ? element.getBoundingClientRect().width : 0);

export const useBravaisSeamRowFit = ({
    rowRef,
    navRef,
    accountRef,
    measureRef,
}: {
    /** 整条横条（flex 一行）。 */
    rowRef: RefObject<HTMLElement | null>;
    /** 导航段（唯一可伸缩、放不下时在里面滚的一段）。 */
    navRef: RefObject<HTMLElement | null>;
    /** 此刻的账户入口（没有时为 null）。 */
    accountRef: RefObject<HTMLElement | null>;
    /** 测量副本的容器：里面是 data-bravais-row-measure="titled|untitled|no-shortcuts|short|account-full|account-compact"。 */
    measureRef: RefObject<HTMLElement | null>;
}): BravaisSeamRowFit => {
    const [fit, setFit] = useState<BravaisSeamRowFit>(FITS);

    useLayoutEffect(() => {
        const row = rowRef.current;
        const nav = navRef.current;
        const measureBox = measureRef.current;
        if (!row || !nav || !measureBox || typeof ResizeObserver === 'undefined') return undefined;
        const copy = (name: string) => widthOf(measureBox.querySelector(`[data-bravais-row-measure="${name}"]`));
        const measure = () => {
            const rowStyle = getComputedStyle(row);
            const content = row.clientWidth - (parseFloat(rowStyle.paddingLeft) || 0) - (parseFloat(rowStyle.paddingRight) || 0);
            const gap = parseFloat(rowStyle.columnGap) || 0;
            let others = 0;
            let count = 0;
            for (const child of Array.from(row.children)) {
                if (child === measureBox || getComputedStyle(child).position === 'absolute') continue;
                count += 1;
                if (child !== nav && child !== accountRef.current) others += widthOf(child);
            }
            // 没有账户入口时副本也是空的（宽 0），段间距少算一个。
            const hasAccount = Boolean(accountRef.current);
            const available = content - others - gap * Math.max(0, count - 1);
            const navGap = parseFloat(getComputedStyle(nav).columnGap) || 0;
            const extras = Array.from(nav.querySelectorAll('[data-bravais-row-extra]'))
                .reduce((sum, element) => sum + widthOf(element) + navGap, 0);
            const next = resolveSeamRowFit({
                available,
                extras,
                nav: { titled: copy('titled'), untitled: copy('untitled'), noShortcuts: copy('no-shortcuts'), short: copy('short') },
                account: hasAccount ? { full: copy('account-full'), compact: copy('account-compact') } : { full: 0, compact: 0 },
            });
            setFit(current => (
                current.level === next.level && current.shortcuts === next.shortcuts && current.accountCompact === next.accountCompact
                    && current.overflowing === next.overflowing ? current : next
            ));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        for (const child of Array.from(row.children)) if (child !== nav) observer.observe(child);
        for (const child of Array.from(measureBox.children)) observer.observe(child);
        for (const extra of Array.from(nav.querySelectorAll('[data-bravais-row-extra]'))) observer.observe(extra);
        // 扫描进度、管理隐藏、状态、过滤位会出现 / 消失：子节点变了重新挂观察。
        const mutations = new MutationObserver(() => {
            observer.disconnect();
            observer.observe(row);
            for (const child of Array.from(row.children)) if (child !== nav) observer.observe(child);
            for (const child of Array.from(measureBox.children)) observer.observe(child);
            for (const extra of Array.from(nav.querySelectorAll('[data-bravais-row-extra]'))) observer.observe(extra);
            measure();
        });
        mutations.observe(row, { childList: true });
        mutations.observe(nav, { childList: true, subtree: true });
        return () => {
            observer.disconnect();
            mutations.disconnect();
        };
    }, [accountRef, measureRef, navRef, rowRef]);

    return fit;
};
