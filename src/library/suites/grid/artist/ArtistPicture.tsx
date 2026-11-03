import React, { useState } from 'react';
import { Disc } from 'lucide-react';

// src/library/suites/grid/artist/ArtistPicture.tsx
// The artist's round picture, filling the ring it is put in. The picture it is given may change
// while it is on show: a page opened from a card shows that card's cover until the artist has
// been read, then the artist's own. The new picture comes in over the old once it has loaded,
// and the old is taken away when the new is fully in, so the ring is never seen empty between
// the two. With no picture to show, a disc.
//
// The first <img> in the ring is the picture on show; with none on show (a disc), it is the one
// that is coming in. A cover that flies to the ring, or from it, reads the ring's picture off
// that element (suites/grid/transitions/morphProbes.ts).

/** A picture comes in over the one before it in this long. */
const COMES_IN_MS = 300;

interface ArtistPictureProps {
    url: string | null;
    /** A picture that has loaded is on show at once, with nothing seen of its coming (reduced motion). */
    instant?: boolean;
}

export const ArtistPicture: React.FC<ArtistPictureProps> = ({ url, instant = false }) => {
    // The picture on show. The first one given is, from the first render: a cover that has just
    // flown here is loaded already, and one that is not shows when it has.
    const [shown, setShown] = useState(url);
    // Nothing to show any more (an artist that turns out to have no picture): the one on show goes.
    if (!url && shown) setShown(null);
    const coming = url && url !== shown ? url : null;
    // One list, so that the picture coming in is the same element when it is the one on show.
    const pictures = [shown, coming].filter((picture): picture is string => Boolean(picture));

    // A picture that has loaded comes in, and is the one on show when it is in. Its opacity is
    // written on the element, not kept as state: React goes on rendering it see-through for as
    // long as it is the one coming, and writes nothing where that has not changed. The end is
    // the animation's own, which comes whether or not the ring is drawn at the time.
    const comeIn = (image: HTMLImageElement, picture: string) => {
        // One that is no longer wanted has been taken off the page meanwhile.
        const isIn = () => { if (image.isConnected) setShown(picture); };
        image.style.opacity = '1';
        if (instant) {
            isIn();
            return;
        }
        image.animate([{ opacity: 0 }, { opacity: 1 }], { duration: COMES_IN_MS, easing: 'ease-out' }).finished.then(isIn, () => {});
    };

    return (
        <>
            {!shown && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/5">
                    <Disc size={48} className="opacity-20 animate-spin" style={{ animationDuration: '4s' }} />
                </div>
            )}
            {pictures.map(picture => (
                <img
                    key={picture}
                    src={picture}
                    alt="avatar"
                    draggable={false}
                    decoding="sync"
                    className="absolute inset-0 w-full h-full object-cover select-none"
                    {...(picture === coming ? {
                        onLoad: (event: React.SyntheticEvent<HTMLImageElement>) => comeIn(event.currentTarget, picture),
                        style: { opacity: 0 },
                    } : {})}
                />
            ))}
        </>
    );
};
