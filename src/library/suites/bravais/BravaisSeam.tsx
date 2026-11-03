import React, { useCallback, useRef, type RefObject } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisHomeShortcut } from './bravaisHomeModels';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import type { SeamAxis } from '../../../components/wall/seamPlan';
import type { BravaisSeamContentVariant } from './bravaisSeamTarget';
import type { BravaisPanelActions } from './BravaisListPanel';
import BravaisSeamContent from './BravaisSeamContent';
import { BravaisSeamNavigation } from './BravaisSeamCrumbs';
import type { LibraryNavigationContext } from '../../core/suite/suite.contract';

// src/library/suites/bravais/BravaisSeam.tsx
// 缝与它的边缘标签。缝的屏幕位置、宽度、内容透明度、标签显隐都由 stage 每帧直接写（bravaisFrame），这里只在
// 渲染的内容换了时渲染。内容层按「此刻渲染的这一套」的宽度排版、居中，被变窄的缝裁掉（翻转不重排）；底部内边距
// 绑在播放条安全区的 MotionValue 上。标签：自动出屏收起时点它在当前视口裂开新缝，手动折叠时点它恢复。
// 登录与切换确认不在缝里：登录是共用的登录窗口（src/components/login），确认框是回退到的 grid account surface。
// fb4（缝内的过渡）：每一次整条翻走——转出的半圈（降低动效时的淡出）里旧内容一律 inert + aria-hidden，
// 读屏与用例只看得到要换上的那一层。
// 当前页过滤（设计稿 §7.6）：输入位在缝的内容里（BravaisSeamFilterField，随内容翻牌），不再给命令面板的内联框留锚点。
// 信息条横向（axis 'y'）：缝是一道横条（data-bravais-seam-axis="y"，bravaisSeamRow.css），内容按「此刻渲染的这一套」的
// 高度排版、竖直居中，底部不留播放条安全区（横条不贴底）；开口落定时横条不裁内容（菜单可以伸出横条，renderFrame 写
// data-bravais-seam-settled）。

type BravaisSeamProps = {
    seamRef: RefObject<HTMLDivElement | null>;
    contentRef: RefObject<HTMLDivElement | null>;
    tabRef: RefObject<HTMLButtonElement | null>;
    variant: BravaisSeamContentVariant;
    /** 这套内容开在哪个方向（折叠时为 null，按竖的画）。 */
    axis: SeamAxis | null;
    /** 正画着的内容正要翻走（useBravaisSeam 的 leaving）。 */
    leaving: boolean;
    /** 此刻渲染的那一套内容的排版宽度（翻转不重排；横条是排版高度）。 */
    contentWidth: number;
    layer: BravaisLayer | null;
    /** 当前层（标签上的标题跟着它，不等内容翻转）。 */
    currentLayer: BravaisLayer | null;
    level: BravaisSeamLevel;
    /** 导航快照（B11：面包屑的深度、来源与各层名字，经 context 交给缝里的面包屑）。 */
    navigation: LibraryNavigationContext;
    bottomPx: MotionValue<number>;
    setLevel: (level: BravaisSeamLevel) => void;
    /** 点边缘标签（键盘激活时 event.detail 为 0）。 */
    onTab: (event: React.MouseEvent<HTMLButtonElement>) => void;
    /** B7：完整信息条的「列表」与列表面板的动作。 */
    openList?: () => void;
    panel?: BravaisPanelActions;
    /** 首页窄缝的直达入口（特殊集合）。 */
    openShortcut?: (shortcut: BravaisHomeShortcut) => void;
};

const BravaisSeam: React.FC<BravaisSeamProps> = ({
    seamRef,
    contentRef,
    tabRef,
    variant,
    axis,
    leaving,
    contentWidth,
    layer,
    currentLayer,
    level,
    navigation,
    bottomPx,
    setLevel,
    onTab,
    openList,
    panel,
    openShortcut,
}) => {
    const { t } = useTranslation();
    const width = contentWidth;
    const row = axis === 'y';
    const tabLabel = currentLayer?.seam.title ?? '';
    const hideLeaving = leaving;
    // 渲染时就写：缝里的内容卸载（cleanup）时读到的已经是这一轮的当前层。
    const currentLayerKeyRef = useRef<string | null>(null);
    currentLayerKeyRef.current = currentLayer?.key ?? null;
    const currentLayerKey = useCallback(() => currentLayerKeyRef.current, []);
    return (
        <>
            <div
                ref={seamRef}
                className="bravais-seam"
                data-bravais-seam={variant}
                data-bravais-seam-axis={row ? 'y' : 'x'}
                data-bravais-seam-level={level}
                aria-label={t('libraryBravais.seamLabel')}
                role="region"
            >
                <div ref={contentRef} className="bravais-seam-content" style={row ? { height: width, marginTop: -width / 2 } : { width, marginLeft: -width / 2 }}>
                    <motion.div
                        className="bravais-seam-body"
                        style={{ paddingBottom: bottomPx }}
                        inert={hideLeaving}
                        aria-hidden={hideLeaving || undefined}
                        data-bravais-seam-leaving={hideLeaving || undefined}
                    >
                        <BravaisSeamNavigation.Provider value={navigation}>
                            <BravaisSeamContent variant={variant} row={row} layer={layer} depth={navigation.depth} actions={{ setLevel, openList, panel, openShortcut, currentLayerKey }} />
                        </BravaisSeamNavigation.Provider>
                    </motion.div>
                </div>
            </div>
            <button
                ref={tabRef}
                type="button"
                className="bravais-seam-tab"
                data-bravais-seam-tab={level === 'hidden' ? 'hidden' : 'collapsed'}
                style={{ display: 'none' }}
                onClick={onTab}
                title={level === 'hidden' ? t('libraryBravais.seamRestore') : t('libraryBravais.seamReopenHere')}
            >
                {tabLabel}
            </button>
        </>
    );
};

export default BravaisSeam;
