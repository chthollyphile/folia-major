import type { SceneAnchor, SceneContext, Vec3 } from '../definition';
import { CINEMA_SPEAKERS } from './cinemaAcoustics';
import { isSeatTaken } from './cinemaGeometry';
import { PROJECTOR, ROWS, SCREEN, rowFloor, rowZ, seatXs } from './cinemaLayout';

// src/components/scenes/cinema/cinemaAnchors.ts
// The hall's anchors, from the same measurements as its geometry (cinemaLayout.ts): the screen, every
// seat (taken ones marked, the preferred one two thirds back in the middle), the two screen speakers (where
// the hall's sound is computed from, cinemaAcoustics.ts), the projector and the lyric place. No three.js here: the seat map reads these too.

/** The picture area of the screen, in the plane of the screen mesh: top-left, top-right, bottom-right, bottom-left. */
const SURFACE_Z = 0.02;
export const SCREEN_CORNERS: readonly [Vec3, Vec3, Vec3, Vec3] = [
    [-SCREEN.width / 2, SCREEN.centerY + SCREEN.height / 2, SURFACE_Z],
    [SCREEN.width / 2, SCREEN.centerY + SCREEN.height / 2, SURFACE_Z],
    [SCREEN.width / 2, SCREEN.centerY - SCREEN.height / 2, SURFACE_Z],
    [-SCREEN.width / 2, SCREEN.centerY - SCREEN.height / 2, SURFACE_Z],
];

/** The row the preferred seat is in: about two thirds back (where halls are calibrated). */
const PREFERRED_ROW = Math.round((ROWS.count - 1) * (2 / 3));

type ViewpointAnchor = Extract<SceneAnchor, { kind: 'viewpoint' }>;

/** Every seat, row by row from the front, left to right; ids `R<row>-<number>`. */
export const cinemaSeats = (): ViewpointAnchor[] => {
    const xs = seatXs();
    const seats: ViewpointAnchor[] = [];
    for (let row = 0; row < ROWS.count; row += 1) {
        xs.forEach((x, index) => {
            const eye: Vec3 = [x, rowFloor(row) + 1.15, rowZ(row, x) - 0.3];
            seats.push({
                kind: 'viewpoint',
                id: `R${row + 1}-${index + 1}`,
                ear: eye,
                eye,
                lookAt: [0, SCREEN.centerY - 0.2, 0],
                row: String(row + 1),
                number: index + 1,
                occupied: isSeatTaken(row, x),
            });
        });
    }
    // The free seat of that row nearest the middle.
    const preferred = seats
        .filter(seat => seat.row === String(PREFERRED_ROW + 1) && !seat.occupied)
        .sort((left, right) => Math.abs(left.eye[0]) - Math.abs(right.eye[0]))[0];
    if (preferred) preferred.preferred = true;
    return seats;
};

export const publishCinemaAnchors = (anchors: SceneContext['anchors']) => {
    anchors.add({ kind: 'surface', id: 'screen', corners: SCREEN_CORNERS });
    cinemaSeats().forEach(seat => anchors.add(seat));
    anchors.add({ kind: 'speaker', id: 'L', position: CINEMA_SPEAKERS.L });
    anchors.add({ kind: 'speaker', id: 'R', position: CINEMA_SPEAKERS.R });
    anchors.add({ kind: 'emitter', id: 'projector', position: [0, PROJECTOR.y, PROJECTOR.z] });
    anchors.add({ kind: 'lyricPlace', id: 'screen', surface: 'screen', rect: { x: 1 / 6, y: 1 / 6, width: 2 / 3, height: 2 / 3 } });
};
