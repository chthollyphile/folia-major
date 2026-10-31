import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Pause, Pin } from "lucide-react";
import { MotionValue } from "framer-motion";
import ProgressBar from "./ProgressBar";
import { PlayerState, LyricData, Theme } from "../types";
import LyricsTimelineModal from "./modal/LyricsTimelineModal";
import TrackTitleNavigator from "./floating-player/TrackTitleNavigator";
import PlayerControlSlotButton from "./floating-player/PlayerControlSlotButton";
import PlayerBarGlow from "./floating-player/PlayerBarGlow";
import PlayerBottomBarPositioner from "./floating-player/PlayerBottomBarPositioner";
import { usePlayerBottomBarBottomPx } from "../hooks/usePlayerBottomBarBottomPx";
import { playerBottomBarLiveOffset } from "../stores/motionSignals";
import { usePlayerBottomBarLayoutStore } from "../stores/usePlayerBottomBarLayoutStore";
import { usePlayerChromeSettingsStore } from "../stores/usePlayerChromeSettingsStore";
import {
  PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
  clampPlayerBottomBarOffset,
  resolvePlayerBottomBarMaxOffset,
} from "../utils/playerBottomBarLayout";
import type {
  PlayerControlSlotActionId,
  PlayerControlSlotContext,
} from "./floating-player/playerControlSlotActions";
import { usePlayerOverlayObstacle } from "../hooks/usePlayerOverlayLayout";
import { useGlass } from "../shinoinject/useGlass.tsx";
import { releaseGlassJelly } from "../shinoinject/liquidglass.ts";
import { HifiProgressRow } from "./hifi/HifiBadge";
import { useIsHifiRoute } from "./hifi/useHifiSignalPath";
import { resolveLyricSeekMediaTime } from "../utils/lyrics/lyricSeekTime";

export interface TrackNavigation {
  /** 当前曲目的稳定身份，用于识别「确实换歌了」；相邻两首同名时标题字符串不变，不能拿标题判断 */
  currentTrackKey: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  prevTitle: string | null;
  nextTitle: string | null;
  prevLabel: string;
  nextLabel: string;
}

const CONTROL_LAYOUT_SPRING = {
  type: "spring" as const,
  stiffness: 280,
  damping: 24,
};

/*
 * 页面切换时胶囊的宽高 / 圆角整套变化，走 framer 的 layout 动画，动画期间逐帧改写 inline transform。
 * 果冻会话同样在写 transform（收编 base 后叠加形变），两者同时进行会互相覆盖：
 * 切换那一瞬间按下的拖拽会被 layout 修正吃掉，观感上就是「果冻失效」。
 * 所以切换时先摘掉 data-glass-jelly 并收掉进行中的会话，等动画放完再挂回去。
 *
 * 判定只看 DOM：每帧比一次胶囊的 inline transform，连续静默若干帧即视为落定。不依赖 framer 的
 * 动画回调 —— 尺寸没变时它根本不触发，而单纯用固定超时又会在这段时间里真的没有果冻。
 * 超时只是最后一道保险，防动画被中断后一直挂着。
 */
const JELLY_REARM_QUIET_FRAMES = 6;
const JELLY_REARM_MIN_WAIT_MS = 180;
const JELLY_REARM_MAX_WAIT_MS = 1200;

const HOVER_EXPAND_DELAY_MS = 20;
const HOVER_COLLAPSE_DELAY_MS = 100;
const HOVER_HITBOX_BOTTOM_BUFFER_PX = 32;
/*
 * 模组可以通过公开变量 --folium-player-bar-extra 加宽胶囊，补回进度条两侧按钮占掉的长度。
 * 外层 max-width 已经加了一份 extra；收起的胶囊是外层的 80% / 60%，所以只再补 (1 - 比例) 份，
 * 外层顶到 max-width 时收起胶囊正好宽出 extra。
 */
const COLLAPSED_WIDTH_CLASS =
  "w-[min(100%,calc(80%_+_var(--folium-player-bar-extra,0px)_*_0.2))] md:w-[min(100%,calc(60%_+_var(--folium-player-bar-extra,0px)_*_0.4))]";

/**
 * 槽位上下文里由 App 提供的部分。循环模式、歌词时间轴和上一首/下一首的可用性
 * 胶囊自己已经有了，不让调用方重复传一遍。
 */
export type SlotContextFromApp = Omit<
  PlayerControlSlotContext,
  | "loopMode"
  | "onToggleLoop"
  | "onToggleTimeline"
  | "hasLyrics"
  | "canPrev"
  | "canNext"
  | "onPrev"
  | "onNext"
>;

interface FloatingPlayerControlsProps {
  currentSong: { name: string } | null;
  playerState: PlayerState;
  currentTime: MotionValue<number>;
  lyricCurrentTime?: MotionValue<number>;
  duration: number;
  loopMode: "off" | "all" | "one";
  currentView: "home" | "player" | "lattice";
  audioSrc: string | null;
  canTogglePlay?: boolean;
  lyrics: LyricData | null;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onNavigateToPlayer: () => void;
  onFocusLatticeCurrentSong?: () => void;
  noTrackText?: string;
  primaryColor?: string;
  secondaryColor?: string;
  theme?: Theme;
  isDaylight: boolean;
  isHidden?: boolean;
  hideControlBar?: boolean;
  controlsDisabled?: boolean;
  trackNavigation?: TrackNavigation | null;
  /** 右侧两个可自定义槽位的动作 id。 */
  slotPrimary: PlayerControlSlotActionId;
  slotSecondary: PlayerControlSlotActionId;
  /** 槽位共用的播放上下文里，胶囊自己能提供的那几项在内部补齐。 */
  slotContext: SlotContextFromApp;
  /** 提交定位结果；由 App 写回持久化设置。 */
  onCommitBottomBarOffset: (offsetPx: number) => void;
}

const FloatingPlayerControls: React.FC<FloatingPlayerControlsProps> = ({
  currentSong,
  playerState,
  currentTime,
  lyricCurrentTime,
  duration,
  loopMode,
  currentView,
  audioSrc,
  canTogglePlay = false,
  lyrics,
  onSeek,
  onTogglePlay,
  onToggleLoop,
  onNavigateToPlayer,
  onFocusLatticeCurrentSong,
  noTrackText = "No Track",
  primaryColor = "var(--text-primary)",
  secondaryColor = "var(--text-secondary)",
  theme,
  isDaylight,
  isHidden = false,
  hideControlBar = false,
  controlsDisabled = false,
  trackNavigation = null,
  slotPrimary,
  slotSecondary,
  slotContext,
  onCommitBottomBarOffset,
}) => {
  const { t } = useTranslation();
  const { ref: layoutRef, invalidate: invalidateLayout } =
    usePlayerOverlayObstacle("player-controls", "playback", !isHidden);
  // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
  const glassBgExpanded = isDaylight
    ? "bg-white/60 border border-white/20 shadow-xl"
    : "bg-black/40 border border-white/5";
  const glassBgCollapsed = isDaylight
    ? "bg-white/40 border border-white/20 shadow-lg hover:bg-white/50"
    : "bg-black/20 border border-white/5 hover:bg-black/30";
  const trackColor = isDaylight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.1)";
  // Button bg logic
  const buttonBg = isDaylight
    ? { backgroundColor: primaryColor, color: "var(--bg-color)" }
    : { backgroundColor: primaryColor, color: "var(--bg-color)" }; // Keep primary for play button, looks good

  // Other buttons hover
  const iconBtnExpandedClass = isDaylight ? "hover:bg-black/5" : "bg-white/20"; // Wait, loop button has logic
  const iconBtnClass = isDaylight
    ? "hover:bg-black/5 text-black/60"
    : "hover:bg-white/10 opacity-40 hover:opacity-100";

  const [isHovered, setIsHovered] = useState(false);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const expandTimeoutRef = useRef<number | null>(null);
  const collapseTimeoutRef = useRef<number | null>(null);
  // 果冻注入开关：页面切换时先摘掉，等胶囊的 layout 动画放完再挂回去。
  const [jellyArmed, setJellyArmed] = useState(true);
  const jellyRearmRafRef = useRef<number | null>(null);
  const capsuleElRef = useRef<HTMLElement | null>(null);
  const disarmJelly = useCallback(() => {
    // 先让进行中的会话收摊：它写的是同一个 inline transform，留着会和 layout 动画互相覆盖。
    releaseGlassJelly();
    setJellyArmed(false);
    if (jellyRearmRafRef.current !== null) {
      cancelAnimationFrame(jellyRearmRafRef.current);
      jellyRearmRafRef.current = null;
    }
    // 等 transform 连续若干帧不再变化（layout spring 放完）再挂回果冻。
    // 读的是 inline transform（framer 的 layout 动画逐帧写这里），不触发样式重算；
    // 只靠 DOM 状态判断，不依赖动画库的回调。超时是动画被打断时的保险。
    const startedAt = performance.now();
    let lastTransform: string | null = null;
    let quietFrames = 0;
    const waitForSettle = () => {
      jellyRearmRafRef.current = null;
      const el = capsuleElRef.current;
      if (!el || !el.isConnected) {
        setJellyArmed(true);
        return;
      }
      const transform = el.style.transform;
      quietFrames = transform === lastTransform ? quietFrames + 1 : 0;
      lastTransform = transform;
      const elapsed = performance.now() - startedAt;
      // 至少等一小段：切换那一帧 transform 还没开始变，只比一次会立刻判成「已静止」。
      const settled = elapsed >= JELLY_REARM_MIN_WAIT_MS
        && (quietFrames >= JELLY_REARM_QUIET_FRAMES || elapsed >= JELLY_REARM_MAX_WAIT_MS);
      if (settled) {
        setJellyArmed(true);
        return;
      }
      jellyRearmRafRef.current = requestAnimationFrame(waitForSettle);
    };
    jellyRearmRafRef.current = requestAnimationFrame(waitForSettle);
  }, []);
  // 胶囊节点同时交给 overlay 布局注册和果冻重挂的等待逻辑，两个 ref 都要拿到它。
  const attachCapsule = useCallback(
    (el: HTMLDivElement | null) => {
      capsuleElRef.current = el;
      layoutRef(el);
    },
    [layoutRef],
  );

  const bottomBarBottomPx = usePlayerBottomBarBottomPx();
  const isPositioning = usePlayerBottomBarLayoutStore(
    (state) => state.isPositioning,
  );
  const commitPositioning = usePlayerBottomBarLayoutStore(
    (state) => state.commitPositioning,
  );
  const cancelPositioning = usePlayerBottomBarLayoutStore(
    (state) => state.cancelPositioning,
  );
  // 拖动起点：按下时的指针 Y 和当时的偏移量。位移是相对的，靠这两个值换算成绝对偏移量。
  const dragOriginRef = useRef<{ pointerY: number; offset: number } | null>(
    null,
  );
  const [maxOffsetPx, setMaxOffsetPx] = useState(() =>
    typeof window === "undefined"
      ? PLAYER_BOTTOM_BAR_BASE_OFFSET_PX
      : resolvePlayerBottomBarMaxOffset(window.innerHeight),
  );

  const canAutoExpand = canTogglePlay && duration > 0;
  // 固定：胶囊不再随指针离开而收缩，一直保持展开。
  const playerBarPinned = usePlayerChromeSettingsStore(
    (state) => state.playerBarPinned,
  );
  const togglePlayerBarPinned = usePlayerChromeSettingsStore(
    (state) => state.handleTogglePlayerBarPinned,
  );
  // 定位模式强制展开：用户要看到的是最终形态的胶囊，而不是一条细进度条。
  const showExpanded =
    isPositioning ||
    playerBarPinned ||
    isHovered ||
    (canAutoExpand &&
      playerState !== PlayerState.PLAYING &&
      currentView !== "home");

  // 上限依赖视口高度，窗口变矮时要跟着收，否则虚线框会画到屏幕外。
  useEffect(() => {
    if (!isPositioning) {
      return;
    }

    const syncMax = () =>
      setMaxOffsetPx(resolvePlayerBottomBarMaxOffset(window.innerHeight));
    syncMax();
    window.addEventListener("resize", syncMax);
    return () => window.removeEventListener("resize", syncMax);
  }, [isPositioning]);

  const handlePositionDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isPositioning) {
        return;
      }
      dragOriginRef.current = {
        pointerY: e.clientY,
        offset: playerBottomBarLiveOffset.get(),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isPositioning],
  );

  const handlePositionDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const origin = dragOriginRef.current;
      if (!origin) {
        return;
      }
      // 只写 MotionValue，不进 React 更新路径：这是 pointer move 级别的高频回调。
      // 指针往上走 clientY 变小，偏移量要变大，所以是 origin.pointerY - e.clientY。
      playerBottomBarLiveOffset.set(
        clampPlayerBottomBarOffset(
          origin.offset + (origin.pointerY - e.clientY),
          window.innerHeight,
        ),
      );
    },
    [],
  );

  const handlePositionDragEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragOriginRef.current) {
        return;
      }
      dragOriginRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [],
  );

  // 定位模式只在播放页的控制条上成立。离开播放页或把控制条整条隐藏后，
  // 拖手和退出按钮都不在场了，状态留着会把胶囊永久钉在展开且不可交互的样子上。
  useEffect(() => {
    if (isPositioning && (currentView !== "player" || hideControlBar)) {
      cancelPositioning();
    }
  }, [cancelPositioning, currentView, hideControlBar, isPositioning]);

  // 页面切换会让胶囊的宽度 / 圆角 / 展开形态整套变化，走的是 framer 的 layout 动画。
  // 那段时间 transform 归动画，果冻先摘掉，等动画放完再挂回；卸载时停掉等待帧。
  // 只在 currentView 变化时做：悬停展开也会触发 layout 动画，但那时指针正要按下，
  // 摘掉果冻只会让「一悬停就拖不动」。首次挂载也不摘，那时没有需要让位的动画。
  const previousViewRef = useRef(currentView);
  useEffect(() => {
    if (previousViewRef.current === currentView) {
      return;
    }
    previousViewRef.current = currentView;
    disarmJelly();
  }, [currentView, disarmJelly]);

  useEffect(() => () => {
    if (jellyRearmRafRef.current !== null) {
      cancelAnimationFrame(jellyRearmRafRef.current);
      jellyRearmRafRef.current = null;
    }
  }, []);

  // 卸载时兜底：当前歌曲被清空会让整条控制条不再渲染，上面那个 effect 也就没机会跑，
  // 定位状态会残留成一个谁也退不出的模式。用 getState 读，避免把 cleanup 绑到回调身份上。
  const isPositioningRef = useRef(isPositioning);
  isPositioningRef.current = isPositioning;
  useEffect(
    () => () => {
      if (isPositioningRef.current) {
        usePlayerBottomBarLayoutStore.getState().cancelPositioning();
      }
    },
    [],
  );

  const handleCommitPositioning = useCallback(() => {
    onCommitBottomBarOffset(commitPositioning());
  }, [commitPositioning, onCommitBottomBarOffset]);

  // Esc 取消回滚，Enter 确认。定位模式是个全屏态，键盘出口是必须的。
  useEffect(() => {
    if (!isPositioning) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPositioning();
      } else if (event.key === "Enter") {
        event.preventDefault();
        handleCommitPositioning();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelPositioning, handleCommitPositioning, isPositioning]);

  // 命中区补丁按离底距离收敛。抬高后胶囊下面不再是屏幕边缘，多出来的 padding
  // 只会变成一块吃掉指针事件的死区。
  //
  // 读的是已保存值而不是拖动中的 MotionValue：这个数要参与 padding/margin 的布局计算，
  // 跟着每帧变就得每帧 setState。拖动过程中 hover 展开本来也不起作用，落定后自然就对了。
  const savedBottomBarOffset = usePlayerChromeSettingsStore(
    (state) => state.playerBottomBarOffset,
  );
  const hoverHitboxBufferPx = Math.max(
    0,
    Math.round(
      HOVER_HITBOX_BOTTOM_BUFFER_PX -
        (savedBottomBarOffset - PLAYER_BOTTOM_BAR_BASE_OFFSET_PX),
    ),
  );

  // 槽位上下文：调用方给的那份，加上胶囊自己掌握的循环模式、歌词时间轴和相邻曲目可用性。
  const resolvedSlotContext = useMemo<PlayerControlSlotContext>(
    () => ({
      ...slotContext,
      loopMode,
      onToggleLoop,
      onToggleTimeline: () => setIsTimelineOpen(true),
      hasLyrics: !!lyrics,
      canPrev: !!trackNavigation?.canPrev,
      canNext: !!trackNavigation?.canNext,
      onPrev: trackNavigation?.onPrev ?? (() => {}),
      onNext: trackNavigation?.onNext ?? (() => {}),
    }),
    [lyrics, loopMode, onToggleLoop, slotContext, trackNavigation],
  );

  useEffect(() => {
    return () => {
      if (expandTimeoutRef.current !== null) {
        window.clearTimeout(expandTimeoutRef.current);
      }
      if (collapseTimeoutRef.current !== null) {
        window.clearTimeout(collapseTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = () => {
    if (collapseTimeoutRef.current !== null) {
      window.clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }

    if (expandTimeoutRef.current !== null) {
      return;
    }

    expandTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(true);
      expandTimeoutRef.current = null;
    }, HOVER_EXPAND_DELAY_MS);
  };

  const handleMouseLeave = () => {
    if (expandTimeoutRef.current !== null) {
      window.clearTimeout(expandTimeoutRef.current);
      expandTimeoutRef.current = null;
    }

    if (!isHovered || collapseTimeoutRef.current !== null) {
      return;
    }

    collapseTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
      collapseTimeoutRef.current = null;
    }, HOVER_COLLAPSE_DELAY_MS);
  };

  const handleClick = () => {
    if (isPositioning) {
      return;
    }
    if (currentView !== "lattice") {
      onNavigateToPlayer();
    } else {
      onFocusLatticeCurrentSong?.();
    }
  };

  useGlass();
  if (hideControlBar) {
    return null;
  }

  return (
    <>
      {/*
                定位层和动画层必须分开。这一层用 Tailwind 的 `-translate-x-1/2` 做水平居中，
                而下面那层的 animate 会写 y/scale —— framer-motion 生成的 transform 会整个
                盖掉同一节点上的 Tailwind transform，合并两层会让胶囊丢失居中、向右偏出去。
                bottom 走共享 MotionValue（默认 32，即原来的 bottom-8），不是 transform 属性，
                所以挂在这一层不会干扰居中。
            */}
      <motion.div
        className={`absolute left-1/2 -translate-x-1/2 z-60 w-full flex justify-center pointer-events-none
                    ${
                      currentView === "home"
                        ? "max-w-[calc(100vw-120px)] md:max-w-[min(calc(32rem_+_var(--folium-player-bar-extra,0px)),calc(100vw-120px))]"
                        : "max-w-[min(calc(32rem_+_var(--folium-player-bar-extra,0px)),100vw)] px-4"
                    }`}
        style={{ bottom: bottomBarBottomPx }}
        onUpdate={invalidateLayout}
      >
        <motion.div
          className="w-full flex justify-center transition-all duration-300 pointer-events-none"
          onUpdate={invalidateLayout}
          initial={false}
          animate={{
            opacity: isHidden ? 0 : 1,
            y: isHidden ? 24 : 0,
            scale: isHidden ? 0.97 : 1,
          }}
          transition={{ duration: 0.26, ease: "easeOut" }}
          style={{ pointerEvents: isHidden ? "none" : "auto" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="pointer-events-auto w-full flex justify-center"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
              // 这块向下的命中区补丁只在胶囊贴底时才有意义；抬高之后按当前偏移量收敛，
              // 否则胶囊下方会留一条既不可点也挡不住东西的死区。
              paddingBottom: `${hoverHitboxBufferPx}px`,
              marginBottom: `${-hoverHitboxBufferPx}px`,
            }}
          >
            <motion.div
              ref={attachCapsule}
              onUpdate={invalidateLayout}
              onLayoutAnimationComplete={invalidateLayout}
              layout
              data-glass
              // 果冻注入开关：页面切换的 layout 动画期间摘掉，动画放完由 disarmJelly 的帧循环挂回。
              data-glass-jelly={jellyArmed ? "" : undefined}
              data-glass-light
              transition={{ layout: CONTROL_LAYOUT_SPRING }}
              onClick={handleClick}
              // 用原生 pointer 事件而不是 framer-motion 的 drag：位移已经由 playerBottomBarLiveOffset
              // 经外层 lift 表达，再让 drag 往这个节点写一份 y 会叠加成两倍位移；
              // 而且 dragConstraints 依赖的起始值放在 ref 里不会触发重渲染，读到的会是上一帧的。
              data-ponder="player-bar"
              onPointerDown={handlePositionDragStart}
              onPointerMove={handlePositionDragMove}
              onPointerUp={handlePositionDragEnd}
              onPointerCancel={handlePositionDragEnd}
              style={{
                touchAction: isPositioning ? "none" : undefined,
                backgroundColor: isDaylight
                  ? "rgba(255,255,255,0.4)"
                  : "rgba(0,0,0,0.4)",
                borderTop: isDaylight
                  ? "1px solid rgba(0,0,0,0.08)"
                  : "1px solid rgba(255,255,255,0.12)",
                borderBottom: isDaylight
                  ? "1px solid rgba(0,0,0,0.08)"
                  : "1px solid rgba(255,255,255,0.12)",
                outline: "1px solid rgba(40,40,40,0.2)",
                boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4)",
              }}
              className={`backdrop-blur-xl shadow-2xl overflow-hidden rounded-full relative isolate transition-colors duration-300 select-none
                            ${isPositioning ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
                            ${showExpanded ? `p-3 ${glassBgExpanded} w-full` : `px-4 py-2 ${glassBgCollapsed} ${COLLAPSED_WIDTH_CLASS}`}`}
            >
              {/* 播放时从胶囊底边发出的水光：在胶囊内部，z-index: -1 压在内容下面、
                  浮在胶囊自己的底色上面，照亮底边而不盖住控件。
                  expanded 传进去：胶囊展开/收起时画布要重新量一次尺寸。 */}
              <PlayerBarGlow active={playerState === PlayerState.PLAYING} expanded={showExpanded} />
              <motion.div
                layout
                transition={{ layout: CONTROL_LAYOUT_SPRING }}
                // 定位模式下 seek 和所有按钮一起失效：这时胶囊是个被拖的物体，不是控件。
                className={`w-full ${isPositioning ? "pointer-events-none select-none" : ""}`}
              >
                {showExpanded ? (
                  <ExpandedView
                    currentSong={currentSong}
                    playerState={playerState}
                    currentTime={currentTime}
                    lyricCurrentTime={lyricCurrentTime}
                    duration={duration}
                    canTogglePlay={canTogglePlay}
                    onSeek={onSeek}
                    onTogglePlay={onTogglePlay}
                    noTrackText={noTrackText}
                    primaryColor={primaryColor}
                    secondaryColor={secondaryColor}
                    trackColor={trackColor}
                    isDaylight={isDaylight}
                    controlsDisabled={controlsDisabled || isPositioning}
                    trackNavigation={trackNavigation}
                    slotPrimary={slotPrimary}
                    slotSecondary={slotSecondary}
                    slotContext={resolvedSlotContext}
                    isPinned={playerBarPinned}
                    onTogglePinned={() =>
                      togglePlayerBarPinned(!playerBarPinned)
                    }
                  />
                ) : (
                  <CollapsedView
                    currentTime={currentTime}
                    duration={duration}
                    onSeek={onSeek}
                    primaryColor={primaryColor}
                    secondaryColor={secondaryColor}
                    trackColor={trackColor}
                    controlsDisabled={controlsDisabled}
                  />
                )}
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {isPositioning && (
          <PlayerBottomBarPositioner
            maxOffsetPx={maxOffsetPx}
            accentColor={primaryColor}
            isDaylight={isDaylight}
            onReset={() =>
              playerBottomBarLiveOffset.set(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX)
            }
            onCommit={handleCommitPositioning}
            onCancel={cancelPositioning}
          />
        )}
      </AnimatePresence>

      <LyricsTimelineModal
        isOpen={isTimelineOpen}
        onClose={() => setIsTimelineOpen(false)}
        lyrics={lyrics}
        duration={duration}
        currentTime={lyricCurrentTime ?? currentTime}
        onSeek={(time) => {
          const target = resolveLyricSeekMediaTime(time, {
            mediaTimeSec: currentTime.get(),
            lyricTimeSec: lyricCurrentTime?.get() ?? currentTime.get(),
            durationSec: duration,
          });
          if (target !== null) onSeek(target);
        }}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        accentColor="var(--text-accent)"
        theme={theme}
        isDaylight={isDaylight}
        disabled={controlsDisabled}
      />
    </>
  );
};

/** 展开视图里进度那一行在网格中的位置；HiFi 路线和 Web 路线共用。 */
const PROGRESS_ROW_CLASS =
  "col-span-3 row-start-3 w-full px-2 sm:col-start-2 sm:col-span-1 sm:row-start-2";

// 展开视图组件
interface ExpandedViewProps {
  currentSong: { name: string } | null;
  playerState: PlayerState;
  currentTime: MotionValue<number>;
  lyricCurrentTime?: MotionValue<number>;
  duration: number;
  canTogglePlay: boolean;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  noTrackText: string;
  primaryColor: string;
  secondaryColor: string;
  trackColor?: string;
  isDaylight?: boolean;
  controlsDisabled?: boolean;
  trackNavigation?: TrackNavigation | null;
  slotPrimary: PlayerControlSlotActionId;
  slotSecondary: PlayerControlSlotActionId;
  slotContext: PlayerControlSlotContext;
  /** 播放条被固定：固定后它不再收缩，按钮呈高亮态。 */
  isPinned: boolean;
  onTogglePinned: () => void;
}

const ExpandedView: React.FC<ExpandedViewProps> = ({
  currentSong,
  playerState,
  currentTime,
  lyricCurrentTime,
  duration,
  canTogglePlay,
  onSeek,
  onTogglePlay,
  noTrackText,
  primaryColor,
  secondaryColor,
  trackColor,
  isDaylight,
  controlsDisabled = false,
  trackNavigation = null,
  slotPrimary,
  slotSecondary,
  slotContext,
  isPinned,
  onTogglePinned,
}) => {
  const { t } = useTranslation();
  const pinLabel = t(isPinned ? "options.playerBarUnpin" : "options.playerBarPin");
  const isHifiRoute = useIsHifiRoute();
  const progressBar = (
    <ProgressBar
      currentTime={currentTime}
      duration={duration}
      onSeek={onSeek}
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
      trackColor={trackColor}
      disabled={controlsDisabled}
    />
  );
  return (
    <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      {/* Desktop Layout - responsive grid positions apply from the sm breakpoint */}
      {/* Mobile Layout - base grid positions apply below the sm breakpoint */}
      {/* Row 1: Centered Title */}
      {/* 窄屏上固定按钮占住标题行最右侧，所以标题右边留出它的位置（宽屏时按钮在右侧按钮组里，标题不挨着它）。 */}
      <div className="col-span-3 row-start-1 min-w-0 pl-2 pr-10 sm:col-start-2 sm:col-span-1 sm:pr-2">
        {trackNavigation ? (
          <TrackTitleNavigator
            title={currentSong?.name || noTrackText}
            trackKey={trackNavigation.currentTrackKey}
            prevTitle={trackNavigation.prevTitle}
            nextTitle={trackNavigation.nextTitle}
            canPrev={trackNavigation.canPrev}
            canNext={trackNavigation.canNext}
            onPrev={trackNavigation.onPrev}
            onNext={trackNavigation.onNext}
            prevLabel={trackNavigation.prevLabel}
            nextLabel={trackNavigation.nextLabel}
            color={primaryColor}
            isDaylight={isDaylight}
            disabled={controlsDisabled}
          />
        ) : (
          <div
            className="truncate text-center text-sm font-bold select-none"
            style={{ color: primaryColor }}
          >
            {currentSong?.name || noTrackText}
          </div>
        )}
      </div>

      {/* Row 3: Loop Button, Play Button, Lyrics Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTogglePlay();
        }}
        disabled={!canTogglePlay || controlsDisabled}
        className={`col-start-2 row-start-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-none bg-(--text-primary) text-black shadow-lg transition-transform sm:col-start-1 sm:row-start-1 sm:row-span-2 ${controlsDisabled ? "cursor-not-allowed opacity-45" : "hover:scale-105"}`}
        style={{ backgroundColor: primaryColor, color: "var(--bg-color)" }}
      >
        {playerState === PlayerState.PLAYING ? (
          <Pause size={20} fill="currentColor" />
        ) : (
          <Play size={20} fill="currentColor" className="ml-1" />
        )}
      </button>

      {/* 两个可自定义槽位。默认仍是循环模式 + 歌词时间轴，和改动前一致。 */}
      <div
        data-ponder-slots
        className="contents sm:col-start-3 sm:row-start-1 sm:row-span-2 sm:flex sm:items-center sm:gap-1"
      >
        <PlayerControlSlotButton
          actionId={slotPrimary}
          context={slotContext}
          primaryColor={primaryColor}
          isDaylight={isDaylight}
          controlsDisabled={controlsDisabled}
          className="col-start-1 row-start-2 justify-self-end sm:justify-self-auto"
        />

        <PlayerControlSlotButton
          actionId={slotSecondary}
          context={slotContext}
          primaryColor={primaryColor}
          isDaylight={isDaylight}
          controlsDisabled={controlsDisabled}
          className="col-start-3 row-start-2 justify-self-start sm:justify-self-auto"
        />

        {/* 固定按钮：固定后播放条不再收缩。窄屏上它占住标题行最右侧的空位，
            宽屏上它跟在两个槽位按钮后面。 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePinned();
          }}
          disabled={controlsDisabled}
          aria-pressed={isPinned}
          className={`col-start-3 row-start-1 justify-self-end rounded-full p-2 transition-colors sm:col-auto sm:row-auto sm:justify-self-auto ${
            isPinned
              ? isDaylight
                ? "bg-black/10 text-black"
                : "bg-white/20"
              : `opacity-40 hover:opacity-100 ${
                  isDaylight ? "hover:bg-black/5" : "hover:bg-white/10"
                }`
          } ${controlsDisabled ? "cursor-not-allowed" : ""}`}
          style={{ color: primaryColor }}
          title={pinLabel}
          aria-label={pinLabel}
        >
          <Pin
            size={20}
            className="sm:h-[18px] sm:w-[18px]"
            fill={isPinned ? "currentColor" : "none"}
          />
        </button>
      </div>

      {/* Row 2: Current Time, Progress Bar, Duration */}
      {/* HiFi 路线上时长后面多一块 HiFi 徽标，按这一行的宽度换长短，进度条留够最小宽度；Web 路线和原来一模一样。 */}
      {isHifiRoute ? (
        <HifiProgressRow
          className={PROGRESS_ROW_CLASS}
          isDaylight={isDaylight}
          disabled={controlsDisabled}
        >
          {progressBar}
        </HifiProgressRow>
      ) : (
        <div className={PROGRESS_ROW_CLASS}>{progressBar}</div>
      )}
    </div>
  );
};

// 折叠视图组件
interface CollapsedViewProps {
  currentTime: MotionValue<number>;
  duration: number;
  onSeek: (time: number) => void;
  primaryColor: string;
  secondaryColor: string;
  trackColor?: string;
  controlsDisabled?: boolean;
}

const CollapsedView: React.FC<CollapsedViewProps> = ({
  currentTime,
  duration,
  onSeek,
  primaryColor,
  secondaryColor,
  trackColor,
  controlsDisabled = false,
}) => {
  return (
    <div className="flex items-center w-full justify-center h-8 px-4">
      <ProgressBar
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        trackColor={trackColor}
        disabled={controlsDisabled}
        collapsed
      />
    </div>
  );
};

export default FloatingPlayerControls;
