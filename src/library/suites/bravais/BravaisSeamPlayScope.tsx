import React from 'react';
import { Play, Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisSeamModel } from './bravaisLayer';

// src/library/suites/bravais/BravaisSeamPlayScope.tsx
// 缝、列表面板与海报上的「播放全部」。集合给了随机播放（core 的 shuffle-scope）时按钮切成两半：
// 左边照常从头播放当前范围，右边一格随机播放（当前范围打乱后成为队列）；没给时还是原来的一颗按钮。

type BravaisSeamPlayScopeProps = {
    seam: Pick<BravaisSeamModel, 'onPlayScope' | 'onShuffleScope' | 'scopeLabels'>;
    /** 这一处按钮的样式类（缝里是 bravais-chrome-button，海报上是 bravais-poster-button）。 */
    buttonClassName: string;
};

const BravaisSeamPlayScope: React.FC<BravaisSeamPlayScopeProps> = ({ seam, buttonClassName }) => {
    const { t } = useTranslation();
    if (!seam.onPlayScope) return null;
    const split = Boolean(seam.onShuffleScope);
    const play = (
        <button type="button" className={`${buttonClassName} is-primary${split ? ' is-split-main' : ''}`} data-bravais-seam-action="play-scope"
            onClick={seam.onPlayScope}>
            <Play aria-hidden />{seam.scopeLabels?.play ?? t('libraryBravais.playAll')}
        </button>
    );
    if (!split) return play;
    const shuffleLabel = t('playlist.shufflePlay');
    return (
        <span className="bravais-split-button" role="group" aria-label={seam.scopeLabels?.play ?? t('libraryBravais.playAll')}>
            {play}
            <button type="button" className={`${buttonClassName} is-primary is-split-side`} data-bravais-seam-action="shuffle-scope"
                onClick={seam.onShuffleScope} aria-label={shuffleLabel} title={shuffleLabel}>
                <Shuffle aria-hidden />
            </button>
        </span>
    );
};

export default BravaisSeamPlayScope;
