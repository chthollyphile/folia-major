import React, { useRef } from 'react';
import { Disc } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { LikeButton, type SongLike } from './LikeButton';
import { useMeasuredSize } from './useMeasuredSize';

// src/components/panelTab/shell/SongHeader.tsx
// The playing song at the top of the panel. On the cover tab it is the large cover with what the
// caller puts under it (title, artists, album, the row of actions). On every other tab it folds to
// one line: a small cover, title, artist and the heart; a press on that line goes to the cover tab.
// Both forms are in the document at once, so the cover can grow and shrink between them.

/** The height of the folded line, and the side of its cover. */
export const FOLDED_PX = 48;
/** Between the large cover and what is under it. */
const COVER_GAP_PX = 14;
/** The large cover is never lower than this, however short the window. */
const MIN_COVER_PX = 96;

type SongHeaderProps = {
    /** The cover tab is open: the large form. */
    isBig: boolean;
    currentSong: SongResult | null;
    coverUrl: string | null;
    like: SongLike;
    /** Goes to the cover tab. */
    onShowCover: () => void;
    /** What stands under the large cover. */
    children: React.ReactNode;
};

const SongHeader: React.FC<SongHeaderProps> = ({ isBig, currentSong, coverUrl, like, onShowCover, children }) => {
    const { t } = useTranslation();
    const underRef = useRef<HTMLDivElement>(null);
    const under = useMeasuredSize(underRef);
    const artists = (currentSong ? getProviderSongMetadata(currentSong).artists : []).map(artist => artist.name).join(' / ');
    // The large cover is a square as wide as the panel's inside (100cqw), and lower where the
    // window leaves less: --pn-room is the height PanelShell can give this header.
    const underPx = COVER_GAP_PX + under.height;
    const coverHeight = `clamp(${MIN_COVER_PX}px, calc(var(--pn-room) - ${underPx}px), 100cqw)`;

    return (
        <header
            className="st-t-unfold relative shrink-0 overflow-hidden transition-[height]"
            style={{ height: isBig ? `calc(${coverHeight} + ${underPx}px)` : FOLDED_PX }}
        >
            {/* The cover is where the lessons about this panel's song buttons point (data-ponder-panel-artwork). */}
            <div
                data-ponder-panel-artwork
                onClick={isBig ? undefined : onShowCover}
                className={`st-t-unfold absolute left-0 top-0 grid place-items-center overflow-hidden bg-[var(--st-fill)] transition-[width,height,border-radius] ${isBig ? 'rounded-[10px]' : 'cursor-pointer rounded-lg'}`}
                style={isBig ? { width: '100%', height: coverHeight } : { width: FOLDED_PX, height: FOLDED_PX }}
            >
                {coverUrl ? (
                    <img src={getSizedCoverUrl(coverUrl, 512)} alt="Art" decoding="async" className="h-full w-full object-cover" />
                ) : (
                    <Disc size={isBig ? 40 : 20} className="text-[color:var(--st-t3)]" />
                )}
                <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_var(--st-line)]" />
            </div>

            <button
                // A new song's line comes in as a page of the kit does.
                key={currentSong?.id ?? ''}
                type="button"
                onClick={onShowCover}
                inert={isBig}
                className={`st-page-in st-t-move absolute left-[60px] right-11 top-[5px] flex flex-col text-left transition-[opacity,translate] ${isBig ? '-translate-y-1 opacity-0' : ''}`}
            >
                <span className="truncate text-sm font-semibold leading-5">{currentSong?.name || t('ui.noTrack')}</span>
                <span className="truncate text-xs leading-[18px] text-[color:var(--st-t2)]">{artists}</span>
            </button>
            <LikeButton
                like={like}
                className={`st-t-move absolute right-0 top-2 transition-[opacity,translate,visibility] ${isBig ? 'invisible -translate-y-1 opacity-0' : ''}`}
            />

            <div
                ref={underRef}
                inert={!isBig}
                className={`absolute inset-x-1 bottom-0 transition-[opacity,translate,visibility] ${isBig ? 'st-t-move' : 'st-t-fast invisible translate-y-2 opacity-0'}`}
            >
                {children}
            </div>
        </header>
    );
};

export default SongHeader;
