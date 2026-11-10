import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryNavigationContext } from '../../core/suite/suite.contract';
import { buildBravaisCrumbs, type BravaisCrumb } from './bravaisCrumbs';
import type { BravaisLayer } from './bravaisLayer';
import './bravaisCrumbs.css';

// src/library/suites/bravais/BravaisSeamCrumbs.tsx
// 缝里可点的面包屑（B11，规则在 bravaisCrumbs）：根与中间层点了经层描述的 onPopTo 跳层（宿主走浏览器历史退回，
// beforeBack 由弹栈通知跑一次，这里不跑、也不先关面板——导航层会越过面板记录）；当前层在面板开着时点它 = 关面板；
// 「…」原地展开折叠的中间层。导航快照（深度、来源、各层名字）由 BravaisSeam 经 context 给，不再沿着缝的各套内容逐层传。
// 展开时折起来的那几层依次淡入、从左边滑一点进来（CSS，只动 transform / opacity，降低动效时只淡入）；焦点原本在「…」上
// 的，落到展开出来的第一层（「…」随展开卸载）。收起只随换层发生，由缝的整条翻转带过。

const EMPTY_NAVIGATION: LibraryNavigationContext = { depth: 0, origin: null, activeType: null };

/** BravaisSeam 提供的导航快照（stage 的 navigation prop）。 */
export const BravaisSeamNavigation = createContext<LibraryNavigationContext>(EMPTY_NAVIGATION);

type BravaisSeamCrumbsProps = {
    layer: BravaisLayer;
    /** 面板开着时面板的名字（「列表」「目录」「搜索」）；当前层随之可点（= onClosePanel）。 */
    panelLabel?: string;
    onClosePanel?: () => void;
};

const BravaisSeamCrumbs: React.FC<BravaisSeamCrumbsProps> = ({ layer, panelLabel, onClosePanel }) => {
    const { t } = useTranslation();
    const navigation = useContext(BravaisSeamNavigation);
    // 展开只对展开时的那一层有效：换层（缝的内容翻成别的层）自然收回。
    const [expandedFor, setExpandedFor] = useState<string | null>(null);
    const trailRef = useRef<HTMLSpanElement>(null);
    /** 点「…」时焦点在它上面：展开后把焦点交给展开出来的第一层。 */
    const focusRevealedRef = useRef(false);
    const expanded = expandedFor === layer.key;
    useLayoutEffect(() => {
        if (!expanded || !focusRevealedRef.current) return;
        focusRevealedRef.current = false;
        trailRef.current?.querySelector<HTMLElement>('button[data-bravais-crumb="layer"]')?.focus({ preventScroll: true });
    }, [expanded]);
    const isHomeLayer = layer.surface === 'home';
    const rootLabel = navigation.origin === 'search'
        ? t('libraryBravais.crumbSearch')
        : navigation.origin === 'player' ? t('libraryBravais.crumbPlayer') : t('libraryBravais.homeTitle');
    const crumbs = useMemo(() => {
        const built = buildBravaisCrumbs({
            rootLabel,
            depth: isHomeLayer ? 0 : navigation.depth,
            trail: navigation.trail,
            layerKey: layer.key,
            currentLabel: isHomeLayer ? layer.seam.title : layer.seam.crumb,
            panelLabel,
            expanded,
        });
        return isHomeLayer ? built.filter(crumb => crumb.kind !== 'root') : built;
    }, [expanded, isHomeLayer, layer.key, layer.seam.crumb, layer.seam.title, navigation, panelLabel, rootLabel]);
    const onPopTo = layer.onPopTo;

    /** `reveal`：展开出来的那一层的错开延迟（只给中间层）。 */
    const renderCrumb = (crumb: BravaisCrumb, reveal?: React.CSSProperties) => {
        const className = `bravais-seam-crumb${reveal ? ' is-revealed' : ''}`;
        switch (crumb.kind) {
            case 'root':
            case 'layer':
                return onPopTo ? (
                    <button type="button" className={className} style={reveal} data-bravais-crumb={crumb.kind} data-bravais-crumb-depth={crumb.depth}
                        title={crumb.label} onClick={() => onPopTo(crumb.depth)}>
                        {crumb.label}
                    </button>
                ) : <span className={className} style={reveal} data-bravais-crumb={crumb.kind}>{crumb.label}</span>;
            case 'more':
                return crumb.hidden.length > 0 ? (
                    <button type="button" className="bravais-seam-crumb is-more" data-bravais-crumb="more"
                        aria-label={t('libraryBravais.crumbMore')} title={crumb.hidden.map(target => target.label).join(' › ')}
                        onClick={event => {
                            focusRevealedRef.current = event.currentTarget === document.activeElement;
                            setExpandedFor(layer.key);
                        }}>
                        …
                    </button>
                ) : <span className="bravais-seam-crumb is-more" data-bravais-crumb="more">…</span>;
            case 'current':
                return crumb.closesPanel && onClosePanel ? (
                    <button type="button" className="bravais-seam-crumb is-current" data-bravais-crumb="current" title={crumb.label} onClick={onClosePanel}>
                        {crumb.label}
                    </button>
                ) : <span className="bravais-seam-crumb is-current" data-bravais-crumb="current">{crumb.label}</span>;
            case 'panel':
                return <span className="bravais-seam-crumb is-panel" data-bravais-crumb="panel">{crumb.label}</span>;
            default:
                return null;
        }
    };

    let revealed = 0;
    return (
        <span ref={trailRef} className={`bravais-seam-crumb-trail${expanded ? ' is-expanded' : ''}`} data-bravais-crumbs="">
            {crumbs.map((crumb, index) => {
                // 展开出来的中间层：依次错开 30ms 进来（分隔符跟着它）。
                const reveal = expanded && crumb.kind === 'layer';
                const style = reveal ? { animationDelay: `${(revealed++) * 30}ms` } : undefined;
                return (
                    <React.Fragment key={`${crumb.kind}:${index}`}>
                        {index > 0 && <i className={reveal ? 'is-revealed' : undefined} style={style}>›</i>}
                        {renderCrumb(crumb, style)}
                    </React.Fragment>
                );
            })}
        </span>
    );
};

export default BravaisSeamCrumbs;
