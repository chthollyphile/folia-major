import React from 'react';
import { computeHexCardFrame } from '../../../../utils/hexCardFalloff';
import { SAMPLE_COVERS } from '../kit';

// src/components/modal/settings/pages/pictures.tsx
// What the pages draw themselves: the small pictures of the choices that differ in look, and the
// live preview of the grid cards. All of it is elements and the kit's colour variables, no image
// file. A picture fills the 96 by 64 frame of the kit's PictureChoice.

const HOME_CARD_COVERS = [SAMPLE_COVERS[1], SAMPLE_COVERS[2], SAMPLE_COVERS[0]];

/**
 * One of the two card styles of the home screen (grid3dCardStyle): the card in front with a
 * neighbour on each side. 'image' is the bare cover; 'card' is the cover in a frame with the title
 * and a second line under it.
 */
export const HomeCardStylePicture: React.FC<{ style: 'image' | 'card' }> = ({ style }) => (
    <span className="flex h-full items-center justify-center gap-1.5">
        {HOME_CARD_COVERS.map((color, index) => {
            const inFront = index === 1;
            if (style === 'image') {
                const size = inFront ? 40 : 30;
                return (
                    <span
                        key={color}
                        className="shrink-0 rounded-md shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
                        style={{ width: size, height: size, background: color, opacity: inFront ? 1 : 0.55 }}
                    />
                );
            }
            const size = inFront ? 30 : 22;
            return (
                <span
                    key={color}
                    className="shrink-0 rounded-[5px] bg-[var(--st-raise)] p-[3px] shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
                    style={{ opacity: inFront ? 1 : 0.55 }}
                >
                    <span className="block rounded-[3px]" style={{ width: size, height: size, background: color }} />
                    <span className="mt-1 block h-0.5 w-3/4 rounded-full bg-[var(--st-t1)] opacity-80" />
                    <span className="mb-px mt-0.5 block h-0.5 w-1/2 rounded-full bg-[var(--st-t1)] opacity-35" />
                </span>
            );
        })}
    </span>
);

/** Twelve posters on a five by three wall; the second one is the large poster in focus. */
const WALL_TILES = Array.from({ length: 12 }, (_, index) => SAMPLE_COVERS[(index * 3 + 1) % SAMPLE_COVERS.length]);

/** Eight library cards in four by two; the third one is the song that was pressed. */
const STAY_CARDS = 8;
const STAY_PLAYING_INDEX = 2;

/**
 * Where play lands: 'player' is the lyric lines with the line being sung bright and the progress
 * bar under them; 'lattice' is the queue collage, a wall of covers; 'stay' is the library left as
 * it was, the pressed card in colour with a pause sign on it.
 */
export const EntryViewPicture: React.FC<{ view: 'player' | 'lattice' | 'stay' }> = ({ view }) => (
    view === 'stay' ? (
        <span className="grid h-full grid-cols-4 grid-rows-2 gap-1 p-2">
            {Array.from({ length: STAY_CARDS }, (_, index) => (
                index === STAY_PLAYING_INDEX ? (
                    <span key={index} className="relative rounded-[3px]" style={{ background: SAMPLE_COVERS[2] }}>
                        <span className="absolute bottom-1 right-1 flex gap-px">
                            <span className="h-1.5 w-0.5 rounded-full bg-white" />
                            <span className="h-1.5 w-0.5 rounded-full bg-white" />
                        </span>
                    </span>
                ) : (
                    <span key={index} className="rounded-[3px] bg-[var(--st-t1)] opacity-15" />
                )
            ))}
        </span>
    ) : view === 'player' ? (
        <span className="flex h-full flex-col justify-center gap-[5px] px-3.5 pb-2">
            <span className="h-[3px] w-2/5 rounded-full bg-[var(--st-t1)] opacity-30" />
            <span className="h-1 w-3/4 rounded-full bg-[var(--st-t1)]" />
            <span className="h-[3px] w-1/2 rounded-full bg-[var(--st-t1)] opacity-30" />
            <span className="absolute inset-x-3.5 bottom-2.5 h-0.5 rounded-full bg-[var(--st-track)]">
                <span className="block h-full w-1/3 rounded-full bg-[var(--st-t2)]" />
            </span>
        </span>
    ) : (
        <span className="grid h-full grid-cols-5 grid-rows-3 gap-0.5">
            {WALL_TILES.map((color, index) => (
                <span key={index} className={index === 1 ? 'col-span-2 row-span-2' : undefined} style={{ background: color }} />
            ))}
        </span>
    )
);

const PREVIEW_CARD_COUNT = 7;
const PREVIEW_CARD_GAP = 10;

type GridCardsPreviewProps = {
    minScale: number;
    minOpacity: number;
    fullBleedCover: boolean;
    squareCards: boolean;
};

/**
 * Seven grid cards in a row, the middle one at the centre of the grid and the two at the ends as
 * far out as a card gets. Their size and opacity come from the grid's own computeHexCardFrame, so
 * the preview cannot disagree with the grid about what the two falloff sliders do. The cover fills
 * the card with 全画幅封面 on, and the card is square with 正方形卡片 on (same area, as in the grid).
 */
export const GridCardsPreview: React.FC<GridCardsPreviewProps> = ({ minScale, minOpacity, fullBleedCover, squareCards }) => {
    const [width, height] = fullBleedCover && squareCards ? [78, 78] : [66, 90];
    const pitch = width + PREVIEW_CARD_GAP;
    const middle = (PREVIEW_CARD_COUNT - 1) / 2;

    return (
        <>
            {SAMPLE_COVERS.slice(0, PREVIEW_CARD_COUNT).map((color, index) => {
                const frame = computeHexCardFrame(
                    { baseX: (index - middle) * pitch, baseY: 0 },
                    0,
                    0,
                    { clipRadius: Infinity, maxDistance: middle * pitch, lodStart: 0, lodEnd: 0, minScale, minOpacity },
                );
                return (
                    <div
                        key={color}
                        className="st-t-fast absolute left-1/2 top-1/2 overflow-hidden rounded-md bg-[var(--st-card)] shadow-[0_2px_8px_rgba(0,0,0,0.22),0_0_0_1px_var(--st-line)] transition-[transform,opacity,width,height,margin]"
                        style={{
                            width,
                            height,
                            marginLeft: -width / 2,
                            marginTop: -height / 2,
                            transform: frame.transform,
                            opacity: frame.opacity,
                            zIndex: frame.zIndex,
                        }}
                    >
                        <div className="st-t-move absolute inset-x-0 top-0 transition-[height]" style={{ background: color, height: fullBleedCover ? '100%' : 60 }} />
                        <div className="absolute inset-x-2 bottom-2">
                            <div className={`h-1 rounded-full opacity-80 ${fullBleedCover ? 'bg-white' : 'bg-[var(--st-t1)]'}`} />
                            <div className={`mt-[5px] h-1 w-3/5 rounded-full opacity-35 ${fullBleedCover ? 'bg-white' : 'bg-[var(--st-t1)]'}`} />
                        </div>
                    </div>
                );
            })}
        </>
    );
};
