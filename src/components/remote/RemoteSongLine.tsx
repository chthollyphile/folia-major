import React, { useEffect } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import type { RemoteTrackHandoff } from './useRemoteTrackHandoff';
import { HANDOFF_RETURN_SECONDS } from './useRemoteHandoffClock';

// src/components/remote/RemoteSongLine.tsx
// The song in the remote window, in its two forms: one small line above the lyric (cover 22),
// or the title card that stands in for the lyric when no line is being sung (cover 56).
// One cover element serves both and changes size between them, and it is also the sleeve's large
// cover when the window is not in use; the two texts cross-fade.
// A song change cross-fades the faces the hand-off hook hands over.

/** 换歌：封面和歌名一起淡入淡出。 */
const SWITCH_SECONDS = 0.3;
/** 音频交接：进出场交给本地的不透明度时间轴，外层只需要一个线性的短过渡。 */
const HANDOFF_TRANSITION = { duration: 0.55, ease: 'linear' } as const;

/** A cover as a CSS background. Quoted: a cover address may hold brackets, which end a bare url(). */
export const remoteCoverImage = (url: string | null): string | undefined => (
    url ? `url(${JSON.stringify(url)})` : undefined
);

/**
 * 一张面里跟着音频交接走的那一层不透明度：交接进行时跟着交接的时间轴，交接一停（走完、提前结束、
 * 被取消）就从停下的位置缓回 1。不能在交接停下时直接从 style 里拿掉那个 MotionValue：
 * framer-motion 不会清掉它最后写到元素上的值，面就一直停在半透明（取消过渡后封面变暗）。
 */
const useHandoffFade = (follow: MotionValue<number> | undefined, reduceMotion: boolean): MotionValue<number> => {
    const opacity = useMotionValue(follow ? follow.get() : 1);
    useEffect(() => {
        if (follow) {
            opacity.set(follow.get());
            return follow.on('change', latest => opacity.set(latest));
        }
        const back = animate(opacity, 1, {
            duration: reduceMotion ? 0 : HANDOFF_RETURN_SECONDS * (1 - opacity.get()),
            ease: 'easeOut',
        });
        return () => back.stop();
    }, [follow, opacity, reduceMotion]);
    return opacity;
};

type HandoffFadeProps = {
    follow: MotionValue<number> | undefined;
    reduceMotion: boolean;
    className: string;
    backgroundImage?: string;
    children?: React.ReactNode;
};

const HandoffFade: React.FC<HandoffFadeProps> = ({ follow, reduceMotion, className, backgroundImage, children }) => {
    const opacity = useHandoffFade(follow, reduceMotion);
    return (
        <motion.div className={className} style={{ backgroundImage, opacity }}>
            {children}
        </motion.div>
    );
};

type RemoteCoverFacesProps = {
    handoff: RemoteTrackHandoff;
    /** The class of each picture layer: the small cover and the blurred card background share this component. */
    imageClassName: string;
    reduceMotion: boolean;
};

/** One picture per face. During an audio hand-off the two pictures trade opacity on the hand-off's own clock. */
export const RemoteCoverFaces: React.FC<RemoteCoverFacesProps> = ({ handoff, imageClassName, reduceMotion }) => (
    // 交接的不透明度单独挂在内层：外层只管进出场，两层 opacity 天然相乘，
    // 本地 MotionValue 就不会和 initial/animate/exit 抢同一个 opacity。
    <AnimatePresence initial={false}>
        {handoff.coverFaces.map(face => {
            const handoffOpacity = face.mode === 'incoming'
                ? handoff.handoffIncomingOpacity
                : handoff.isHandoffActive && handoff.hasIncomingCoverFace ? handoff.handoffOutgoingOpacity : undefined;
            return (
                <motion.div
                    key={`cover-${face.key}`}
                    className="remote-cover__face"
                    initial={{ opacity: face.mode === 'incoming' ? 1 : 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={face.mode === 'incoming'
                        ? HANDOFF_TRANSITION
                        : { duration: reduceMotion ? 0 : SWITCH_SECONDS, ease: 'easeInOut' }}
                >
                    <HandoffFade
                        follow={handoffOpacity}
                        reduceMotion={reduceMotion}
                        className={imageClassName}
                        backgroundImage={remoteCoverImage(face.coverUrl)}
                    />
                </motion.div>
            );
        })}
    </AnimatePresence>
);

/** 柔焦的模糊上限，与主窗口风格切换的 softFocus 一致；四舍五入到 0.25px，看不出变化的那几帧不重绘。 */
const RECEDE_BLUR_PX = 8;
const toRecedeBlur = (opacity: number): string => {
    const px = Math.round((1 - opacity) * RECEDE_BLUR_PX * 4) / 4;
    return px > 0 ? `blur(${px}px)` : 'none';
};

type RemoteOutgoingRecedeProps = {
    handoff: RemoteTrackHandoff;
    reduceMotion: boolean;
    children: React.ReactNode;
};

/**
 * 交接期跟着上一首的封面和标题一起退场的部分（歌词行）：同一条退场曲线上的不透明度和柔焦，
 * 从外面套上，里面的组件不用知道交接。平时这一层不带任何样式，和直接放在舞台上一样。
 */
export const RemoteOutgoingRecede: React.FC<RemoteOutgoingRecedeProps> = ({ handoff, reduceMotion, children }) => {
    const opacity = useHandoffFade(handoff.isHandoffActive ? handoff.handoffOutgoingOpacity : undefined, reduceMotion);
    const blur = useTransform(opacity, toRecedeBlur);
    return (
        <motion.div
            className="remote-recede"
            style={{ opacity, filter: reduceMotion ? 'none' : blur }}
        >
            {children}
        </motion.div>
    );
};

type RemoteSongLineProps = {
    /** 'line': a lyric line is on screen and the song is the small line. 'card': the song is the title card. */
    mode: 'line' | 'card';
    handoff: RemoteTrackHandoff;
    reduceMotion: boolean;
};

const RemoteSongLine: React.FC<RemoteSongLineProps> = ({ mode, handoff, reduceMotion }) => {
    const enterOffset = reduceMotion ? 0 : handoff.trackEnterOffset;
    const renderFaces = (form: 'line' | 'card') => (
        <AnimatePresence initial={false}>
            {handoff.faces.map(face => {
                const handoffOpacity = face.mode === 'incoming'
                    ? handoff.handoffIncomingOpacity
                    : handoff.isHandoffActive ? handoff.handoffOutgoingOpacity : undefined;
                return (
                    <motion.div
                        key={`${form}-${face.key}`}
                        className="remote-song__face"
                        initial={face.mode === 'incoming' ? { opacity: 1, x: 0 } : { opacity: 0, x: enterOffset }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -enterOffset }}
                        transition={face.mode === 'incoming'
                            ? HANDOFF_TRANSITION
                            : { duration: reduceMotion ? 0 : SWITCH_SECONDS, ease: 'easeInOut' }}
                    >
                        {form === 'line' ? (
                            <HandoffFade follow={handoffOpacity} reduceMotion={reduceMotion} className="remote-song__row">
                                <span className="remote-song__title">{face.title}</span>
                                {face.artist && <span className="remote-song__artist">{face.artist}</span>}
                            </HandoffFade>
                        ) : (
                            <HandoffFade follow={handoffOpacity} reduceMotion={reduceMotion} className="remote-song__cardtext">
                                <div className="remote-song__cardtitle">{face.title}</div>
                                {face.artist && <div className="remote-song__cardartist">{face.artist}</div>}
                            </HandoffFade>
                        )}
                    </motion.div>
                );
            })}
        </AnimatePresence>
    );

    return (
        <div className="remote-song" data-mode={mode}>
            <div className="remote-cover">
                {!handoff.currentCoverUrl && <div className="remote-cover__blank">F</div>}
                <RemoteCoverFaces handoff={handoff} imageClassName="remote-cover__image" reduceMotion={reduceMotion} />
            </div>
            <div className="remote-song__line" aria-hidden={mode !== 'line'}>{renderFaces('line')}</div>
            <div className="remote-song__card" aria-hidden={mode !== 'card'}>{renderFaces('card')}</div>
        </div>
    );
};

export default RemoteSongLine;
