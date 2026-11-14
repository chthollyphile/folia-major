import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

// src/library/suites/bravais/BravaisSeamBlurb.tsx
// 完整信息条里的一段说明文字：歌手页的简介、集合页的描述（歌单简介、专辑介绍）共用。默认收成 4 行，点一下展开 /
// 收起（只在缝里，不弹浮层，没有过渡：与歌手简介一致）；展开后封顶 14em，再长就在这一块里滚动，并且这一块在缝的
// 纵向空间不够时先让位（bravais.css），按钮不会被挤出可视区。文本按纯文本显示、保留换行（white-space: pre-wrap）。
// 展开状态跟着文本走：换了一段文字（换层、详情到达）就回到收起。

type BravaisSeamBlurbProps = {
    text: string;
    className?: string;
    /** 额外挂上的 data-* 属性（用例按它找这一块），值是 expanded / collapsed。 */
    dataAttribute: `data-${string}`;
};

const BlurbButton: React.FC<BravaisSeamBlurbProps> = ({ text, className, dataAttribute }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const state = isOpen ? 'expanded' : 'collapsed';
    return (
        <button
            type="button"
            className={`bravais-seam-blurb${className ? ` ${className}` : ''}${isOpen ? ' is-open' : ''}`}
            // 展开后这一块自己纵向滚（bravais.css）：标记给 bravaisSeamWheel 的快速判断用。
            data-wheel-scroll-region
            {...{ [dataAttribute]: state }}
            aria-expanded={isOpen}
            title={isOpen ? t('libraryTui.bioLess') : t('libraryTui.bioMore')}
            onClick={() => setIsOpen(open => !open)}
        >
            {text}
        </button>
    );
};

const BravaisSeamBlurb: React.FC<BravaisSeamBlurbProps> = props => <BlurbButton key={props.text} {...props} />;

export default BravaisSeamBlurb;
