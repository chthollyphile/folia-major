// src/components/scenes/cinema/cinemaIntermission.ts
// A pause is an intermission (claude-notes/cinema-scene-ideas.md, part two, 2): a few seconds after
// the music stops the projector's shutter closes, then the house curtains close from both sides, then
// the house lights come up to about half. Play brings the lights down within about a second and opens
// the curtains while the music is already playing. A short pause does nothing, so a quick pause and
// play flashes nothing. Numbers only, no three.js: cinemaScene.ts reads the state every frame.
//
// The curtains move as on a real track: a motor drives the carriage at the top (a ramp up to its
// speed, slowing into its stop), and the hem hangs from it like a pendulum, so it trails while the
// carriage travels and swings a little after it stops, settling slowly.

/** How closed a curtain's leading edge is, 0 open (on its tie-back) to 1 closed (at the centre), at the carriage and at the hem. */
export interface CurtainPose {
    top: number;
    bottom: number;
}

export interface IntermissionState {
    /** The projector's shutter, 1 open (the picture on screen) to 0 shut. */
    shutter: number;
    /** The house lights, 0 down to 1 full; the intermission brings them to half. */
    lights: number;
    left: CurtainPose;
    right: CurtainPose;
}

/** Seconds of pause before the shutter closes; a pause shorter than this changes nothing. */
export const SHUTTER_AFTER = 3;
/** Seconds of pause before the curtains start to close: the shutter is shut by then. */
export const CURTAINS_AFTER = 3.8;
/** The house lights come up once the curtains are this far closed. */
const LIGHTS_AT_CLOSURE = 0.85;
const INTERMISSION_LIGHTS = 0.5;

const SHUTTER_CLOSE_SECONDS = 0.7;
const SHUTTER_OPEN_SECONDS = 0.25;
/** Lights: up slowly (about 3 s), down within about a second. */
const LIGHTS_UP_RATE = 0.9;
const LIGHTS_DOWN_RATE = 4.5;

/** The carriage: top speed (closure per second; a full travel of about 7 m takes about 6 s), how hard it slows into its stop, how fast it gets up to speed. */
const CARRIAGE_SPEED = 0.17;
const CARRIAGE_GAIN = 0.8;
const CARRIAGE_ACCEL = 2.5;
/** The hem as a pendulum under the carriage: a 6 m drop of heavy velvet, lightly damped. The two sides differ a little, as two real curtains would. */
const HEM_OMEGA = [1.6, 1.72];
const HEM_DAMPING = 0.12;
const SUBSTEP = 1 / 120;

const ease = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface CinemaIntermission {
    /**
     * Moves the intermission one frame. playing: the music plays; lightsUp: the house lights up by hand;
     * still (the app's static mode): no ceremony, everything at once where it belongs. onPause false (the
     * user's setting): a pause is no intermission, the picture stays and the curtains stay open (closed ones open).
     */
    step: (dt: number, playing: boolean, lightsUp: boolean, still?: boolean, onPause?: boolean) => IntermissionState;
}

export const createIntermission = (): CinemaIntermission => {
    let pausedFor = 0;
    let lit = false;
    let first = true;
    let carriage = 0;
    let carriageSpeed = 0;
    const hems = HEM_OMEGA.map(omega => ({ omega, at: 0, speed: 0 }));
    const state: IntermissionState = { shutter: 1, lights: 0, left: { top: 0, bottom: 0 }, right: { top: 0, bottom: 0 } };

    const step = (dt: number, playing: boolean, lightsUp: boolean, still = false, onPause = true) => {
        if (still) {
            pausedFor = 0;
            lit = false;
            carriage = 0;
            carriageSpeed = 0;
            hems.forEach(hem => { hem.at = 0; hem.speed = 0; });
            state.shutter = 1;
            state.lights = lightsUp ? 1 : 0;
        } else {
            pausedFor = playing || !onPause ? 0 : pausedFor + dt;
            state.shutter = pausedFor > SHUTTER_AFTER
                ? Math.max(0, state.shutter - dt / SHUTTER_CLOSE_SECONDS)
                : Math.min(1, state.shutter + dt / SHUTTER_OPEN_SECONDS);
            const target = pausedFor > CURTAINS_AFTER ? 1 : 0;
            const count = Math.max(1, Math.ceil(dt / SUBSTEP));
            const h = dt / count;
            for (let index = 0; index < count; index += 1) {
                const wanted = clamp(CARRIAGE_GAIN * (target - carriage), -CARRIAGE_SPEED, CARRIAGE_SPEED);
                carriageSpeed += (wanted - carriageSpeed) * (1 - Math.exp(-CARRIAGE_ACCEL * h));
                carriage += carriageSpeed * h;
                hems.forEach(hem => {
                    hem.speed += (hem.omega * hem.omega * (carriage - hem.at) - 2 * HEM_DAMPING * hem.omega * hem.speed) * h;
                    hem.at += hem.speed * h;
                });
            }
            // The lights come up once the curtains are nearly closed, and stay up until play.
            lit = !playing && (lit || carriage > LIGHTS_AT_CLOSURE);
            const lightsTarget = Math.max(lightsUp ? 1 : 0, lit ? INTERMISSION_LIGHTS : 0);
            state.lights = first ? lightsTarget : ease(state.lights, lightsTarget, lightsTarget > state.lights ? LIGHTS_UP_RATE : LIGHTS_DOWN_RATE, dt);
        }
        first = false;
        state.left.top = carriage;
        state.left.bottom = hems[0]!.at;
        state.right.top = carriage;
        state.right.bottom = hems[1]!.at;
        return state;
    };

    return { step };
};
