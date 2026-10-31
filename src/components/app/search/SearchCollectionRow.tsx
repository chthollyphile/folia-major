import React from 'react';
import { ArrowUpRight, Disc, ListMusic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OmniCollection } from '../../../types/onlineMusic';
import { getSizedCoverUrl } from '../../../utils/coverUrl';

// src/components/app/search/SearchCollectionRow.tsx
// 搜索结果里的一张专辑或一个歌单：整行是一个按钮，点开集合页。专辑封面后面藏着一张唱片，歌单封面后面错开一层色块（search.css）。

type SearchCollectionRowProps = {
    collection: OmniCollection;
    index: number;
    style: React.CSSProperties;
    onOpenCollection: (collection: OmniCollection) => void;
};

const yearOf = (publishedAt?: number) => {
    if (!publishedAt || !Number.isFinite(publishedAt)) return null;
    const year = new Date(publishedAt).getFullYear();
    return year > 1900 ? String(year) : null;
};

const SearchCollectionRow: React.FC<SearchCollectionRowProps> = ({ collection, index, style, onOpenCollection }) => {
    const { t, i18n } = useTranslation();
    const isAlbum = collection.type === 'album';
    const coverUrl = getSizedCoverUrl(collection.coverUrl, 140);
    const artistNames = (collection.artists ?? []).map(artist => artist.name).filter(Boolean).join(' / ');
    const byline = isAlbum
        ? artistNames
        : collection.creator?.nickname || artistNames;
    const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact', maximumFractionDigits: 1 });
    const details = [
        isAlbum ? yearOf(collection.publishedAt) : null,
        !isAlbum && typeof collection.playCount === 'number' && collection.playCount > 0
            ? t('search.playCount', { n: compact.format(collection.playCount) })
            : null,
    ].filter((value): value is string => Boolean(value));
    const trackCount = typeof collection.trackCount === 'number' && collection.trackCount > 0 ? collection.trackCount : null;

    return (
        <div style={style}>
            <button
                type="button"
                onClick={() => onOpenCollection(collection)}
                className="search-row w-full text-left"
                style={{ '--search-row-order': index } as React.CSSProperties}
            >
                <span className="search-row-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className="search-collection-art" aria-hidden="true">
                    {isAlbum ? <span className="search-collection-disc" /> : <span className="search-collection-shadow" />}
                    <span className="search-row-cover flex items-center justify-center">
                        {coverUrl ? (
                            <img src={coverUrl} alt="" loading="lazy" />
                        ) : isAlbum ? (
                            <Disc size={22} className="opacity-30" />
                        ) : (
                            <ListMusic size={22} className="opacity-30" />
                        )}
                    </span>
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
                        {collection.name}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {byline && <span className="min-w-0 truncate">{byline}</span>}
                        {details.map((detail, detailIndex) => (
                            <React.Fragment key={detail}>
                                {(byline || detailIndex > 0) && <span className="shrink-0 opacity-40" aria-hidden="true">/</span>}
                                <span className="shrink-0">{detail}</span>
                            </React.Fragment>
                        ))}
                    </span>
                </span>
                {trackCount !== null && (
                    <span className="hidden shrink-0 font-mono text-xs opacity-45 sm:block">
                        {t('search.trackCount', { n: trackCount })}
                    </span>
                )}
                <ArrowUpRight size={18} className="search-row-arrow" aria-hidden="true" />
            </button>
        </div>
    );
};

export default React.memo(SearchCollectionRow);
