import React from 'react';
import type { LibraryArtistSurfaceProps } from '../../../core/suite/suite.contract';
import { useGridMorphPlan } from '../transitions/useGridMorphPlan';
import ArtistGridView from './ArtistGridView';

// src/library/suites/grid/artist/GridArtistSurface.tsx
// 网格的歌手页 surface：把宿主的契约输入（LibraryArtistSurfaceProps）接到 ArtistGridView 上，
// 移形换影的入场计划由网格自己读。歌手数据是宿主交来的歌手资源（P4.1）；P4.2 起播放端口与 suite 的声明原样
// 交下去，歌手页的入口与命令面板只给「声明 ∩ core 能力」（core/artist/useArtistView）。

const GridArtistSurface: React.FC<LibraryArtistSurfaceProps> = ({
    collection,
    resource,
    playback,
    theme,
    isDaylight,
    isInteractive,
    declaredActions,
    onEditEntity,
    onBack,
    onDone,
    onOpenAlbum,
    onOpenArtist,
}) => {
    const morphPlan = useGridMorphPlan();

    return (
        <ArtistGridView
            collection={collection}
            resource={resource}
            playback={playback}
            declaredActions={declaredActions}
            onBack={onBack}
            onDone={onDone}
            onSelectAlbum={onOpenAlbum}
            onSelectArtist={onOpenArtist}
            theme={theme}
            isDaylight={isDaylight}
            onEditEntity={onEditEntity}
            isInteractive={isInteractive}
            morphPlan={morphPlan}
        />
    );
};

export default GridArtistSurface;
