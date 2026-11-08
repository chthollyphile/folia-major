import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewpointAnchor } from '../engine/sceneViewpoints';

// src/components/scenes/settings/SeatMap.tsx
// A seat map like a ticket app's for any scene with seat anchors: the seats seen from above, the screen
// at the top, taken seats grey and not pickable, the best seat ringed, the chosen one filled. Generic:
// it reads only the anchors (where the eye is, where it looks), never a scene's own code.

interface SeatMapProps {
    seats: readonly ViewpointAnchor[];
    /** The chosen seat's id; null shows the best seat as the one sat in (the camera rigs do the same). */
    chosen: string | null;
    onPick: (seatId: string) => void;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const SeatMap: React.FC<SeatMapProps> = ({ seats, chosen, onPick }) => {
    const { t } = useTranslation();
    if (seats.length === 0) return null;
    const xs = seats.map(seat => seat.eye[0]);
    const zs = seats.map(seat => seat.eye[2]);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const spanX = Math.max(...xs) - minX || 1;
    const spanZ = Math.max(...zs) - minZ || 1;
    // The screen is where the seats look; it goes at the top.
    const screenAtSmallZ = mean(seats.map(seat => seat.lookAt[2])) < mean(zs);
    // A seat is as wide as most of the gap to its neighbour.
    const sorted = [...xs].sort((left, right) => left - right);
    const gaps = sorted.slice(1).map((x, index) => x - sorted[index]).filter(gap => gap > 1e-3);
    const size = Math.min(8, ((gaps.length ? Math.min(...gaps) : spanX) / spanX) * 80);
    const sitting = chosen && seats.some(seat => seat.id === chosen && !seat.occupied) ? chosen : seats.find(seat => seat.preferred)?.id ?? null;
    const name = (seat: ViewpointAnchor) => (seat.row && seat.number !== undefined ? t('ui.sceneSeatName', { row: seat.row, number: seat.number }) : seat.id);

    return (
        <div className="flex flex-col gap-2">
            <div className="mx-auto h-1 w-3/4 rounded-full bg-[var(--st-t3)]" />
            <div className="text-center text-[11px] text-[color:var(--st-t3)]">{t('ui.sceneSeatScreen')}</div>
            {/* The box keeps the hall's proportions; padding leaves room for the seats at its edges. */}
            <div className="px-2 pb-2 pt-1">
                <div className="relative w-full" style={{ paddingBottom: `${(spanZ / spanX) * 100}%` }} role="group" aria-label={t('ui.sceneSeat')}>
                    {seats.map((seat) => {
                        const left = ((seat.eye[0] - minX) / spanX) * 100;
                        const depth = (seat.eye[2] - minZ) / spanZ;
                        const top = (screenAtSmallZ ? depth : 1 - depth) * 100;
                        const isChosen = seat.id === sitting;
                        const label = `${name(seat)}${seat.occupied ? ` · ${t('ui.sceneSeatTaken')}` : ''}${seat.preferred ? ` · ${t('ui.sceneSeatBest')}` : ''}`;
                        return (
                            <button
                                key={seat.id}
                                type="button"
                                disabled={seat.occupied}
                                onClick={() => onPick(seat.id)}
                                title={label}
                                aria-label={label}
                                aria-pressed={isChosen}
                                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-[3px] transition-colors ${
                                    isChosen
                                        ? 'bg-[var(--st-accent)]'
                                        : seat.occupied
                                            ? 'cursor-not-allowed bg-[var(--st-fill)] opacity-50'
                                            : 'bg-[var(--st-fill2)] hover:bg-[var(--st-t3)]'
                                } ${seat.preferred ? 'outline outline-1 outline-offset-1 outline-[color:var(--st-accent)]' : ''}`}
                                style={{ left: `${left}%`, top: `${top}%`, width: `${size}%`, aspectRatio: '1' }}
                            />
                        );
                    })}
                </div>
            </div>
            <div className="flex items-center justify-center gap-4 text-[11px] text-[color:var(--st-t3)]">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[2px] bg-[var(--st-accent)]" />{t('ui.sceneSeatYours')}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[2px] outline outline-1 outline-[color:var(--st-accent)]" />{t('ui.sceneSeatBest')}</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[2px] bg-[var(--st-fill)] opacity-50" />{t('ui.sceneSeatTaken')}</span>
            </div>
        </div>
    );
};

export default SeatMap;
