import type { WallViewCenter } from '../../../components/wall/wallView';

// Bravais 拖拽与释放惯性共用一个 rAF 追目标；输入相机与实际画出的中心分开，停手后收敛并停调度。

type DragMotionOptions = {
    read: () => WallViewCenter;
    write: (center: WallViewCenter, forceRecull: boolean) => void;
    scale: () => number;
    request?: (callback: FrameRequestCallback) => number;
    cancel?: (handle: number) => void;
    now?: () => number;
};

const TIME_CONSTANT_MS = 8;
const REST_DISTANCE_PX = 0.1;

/** 合并同帧输入，按经过的时间插值；取消只停在已画出的位置，不把旧目标补写到下一段运动里。 */
export const createBravaisDragMotion = ({
    read, write, scale,
    request = requestAnimationFrame,
    cancel = cancelAnimationFrame,
    now = () => performance.now(),
}: DragMotionOptions) => {
    let frame: number | null = null;
    let target: WallViewCenter | null = null;
    let previousTime = 0;
    let forceRecull = false;

    const tick = (time: number) => {
        frame = null;
        if (!target) return;
        const current = read();
        const factor = 1 - Math.exp(-Math.max(0, time - previousTime) / TIME_CONSTANT_MS);
        previousTime = Math.max(previousTime, time);
        const next = {
            x: current.x + (target.x - current.x) * factor,
            y: current.y + (target.y - current.y) * factor,
        };
        const settled = Math.hypot(target.x - next.x, target.y - next.y) * scale() <= REST_DISTANCE_PX;
        const center = settled ? target : next;
        const recull = forceRecull;
        forceRecull = false;
        if (settled) target = null;
        write(center, recull);
        if (target && frame === null) frame = request(tick);
    };

    return {
        target: () => target,
        setTarget: (center: WallViewCenter, recull = false) => {
            target = { ...center };
            forceRecull ||= recull;
            if (frame !== null) return;
            previousTime = now();
            frame = request(tick);
        },
        stop: () => {
            if (frame !== null) cancel(frame);
            frame = null;
            target = null;
            forceRecull = false;
        },
    };
};
