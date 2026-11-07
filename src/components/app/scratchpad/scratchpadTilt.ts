import type { Point } from './canvasLayout';

// src/components/app/scratchpad/scratchpadTilt.ts
// 展开整页那张倾斜的纸（设计稿 F：整张纸向右下转，设计稿 6°、实装 4°）上，屏幕坐标与纸上某个元素自己的坐标之间的换算。
// 纸整个转了 deg 度、元素本身不再另转时，元素外接框（getBoundingClientRect）的中心正是它自己的中心转过去的位置，
// 所以只要这个元素的外接框和它自己的宽高（offsetWidth / offsetHeight）就能换算，不用管纸绕哪一点转、里面滚了多少。
// 不倾斜（deg 为 0）时就是减去外接框的左上角。

/**
 * 展开整页那张纸转几度（用户 2026-11-06 从设计稿的 6° 改小）。纸怎么转（ScratchpadSheet）与指针怎么换算（三页的画布、总览）
 * 都读这一个：两边对不上时，越往下（内容越长、离外接框中心越远）框选越偏——播放队列一千多首时偏出几百像素。
 */
export const SCRATCHPAD_TILT_DEG = 4;

/** 绕原点转 deg 度（屏幕坐标系：y 朝下，正的角度顺时针）。 */
export const rotatePoint = (point: Point, deg: number): Point => {
    if (deg === 0) return point;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
};

/** 换算要用到的那一点：元素的外接框与它自己的宽高。 */
export type TiltBox = Pick<HTMLElement, 'getBoundingClientRect' | 'offsetWidth' | 'offsetHeight'>;

/** 屏幕上的一点落在元素自己坐标里的哪儿（左上角是 0, 0）。 */
export const clientToLocal = (element: TiltBox, client: Point, deg: number): Point => {
    const rect = element.getBoundingClientRect();
    if (deg === 0) return { x: client.x - rect.left, y: client.y - rect.top };
    const turned = rotatePoint({ x: client.x - (rect.left + rect.width / 2), y: client.y - (rect.top + rect.height / 2) }, -deg);
    return { x: turned.x + element.offsetWidth / 2, y: turned.y + element.offsetHeight / 2 };
};

/** 元素自己坐标里的一点在屏幕上的哪儿。 */
export const localToClient = (element: TiltBox, local: Point, deg: number): Point => {
    const rect = element.getBoundingClientRect();
    if (deg === 0) return { x: local.x + rect.left, y: local.y + rect.top };
    const turned = rotatePoint({ x: local.x - element.offsetWidth / 2, y: local.y - element.offsetHeight / 2 }, deg);
    return { x: turned.x + rect.left + rect.width / 2, y: turned.y + rect.top + rect.height / 2 };
};
