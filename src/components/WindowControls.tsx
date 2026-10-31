import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Maximize,
  Minimize,
  Minus,
  Pin,
  PinOff,
  Radio,
  Square,
  X,
} from "lucide-react";
import { usePlayerChromeSettingsStore } from "../stores/usePlayerChromeSettingsStore";
import { useAppChromeStore } from "../stores/useAppChromeStore";
import { useGlass } from "@/shinoinject/useGlass";

// 与 AppShell 的 TITLEBAR_REVEAL_HEIGHT、播放桥的 revealThreshold 一致：顶部 56px 是标题栏热区。
const TITLEBAR_REVEAL_HEIGHT = 56;

// 触控拖动时手指可能划到的按钮，也是松手时要触发的动作。
type ControlId =
  | "pin"
  | "remote"
  | "fullscreen"
  | "minimize"
  | "maximize"
  | "close";

export default function WindowControls({
  revealed,
  isDaylight = false,
  isMainWindowClickThroughEnabled = false,
  hideFullscreenButton,
}: {
  revealed: boolean;
  isDaylight?: boolean;
  isMainWindowClickThroughEnabled?: boolean;
  hideFullscreenButton: boolean;
}) {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 指针是否停在控制栏上：没固定时靠它把按钮留在可见状态，移开就随标题栏一起收起。
  const [isPointerInside, setIsPointerInside] = useState(false);
  // 触控按压中：整条控制栏一起放大到 1.5 倍，抬手或手势被取消就还原。
  const [isTouchPressed, setIsTouchPressed] = useState(false);
  // 触控拖动中手指落在哪个按钮上、落在按钮内的 Y：只改显示（跟手的 hover），松手时按它触发动作。
  const [hoveredControl, setHoveredControl] = useState<ControlId | null>(null);
  const [hoverLocalY, setHoverLocalY] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 手势进行中的同步标记：pointerup / touchend 里要立刻判定，不能等 state 刷新。
  const touchActiveRef = useRef(false);
  // 松手已经决定了动作，随后浏览器补上的那次 click 要吞掉，避免同一动作执行两次。
  const swallowClickRef = useRef(false);
  // 手指最后的位置：放大落地后要按这个点重算一次 hover。
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const useNativeMacFullscreenButton = usePlayerChromeSettingsStore(
    (state) => state.useNativeMacFullscreenButton,
  );
  const setIsTitlebarHeld = useAppChromeStore(
    (state) => state.setIsTitlebarHeld,
  );
  // 复用「始终显示标题栏控制按钮」作为固定开关：固定后常驻并写入设置，重启仍然生效。
  const isTitlebarPinned = usePlayerChromeSettingsStore(
    (state) => state.alwaysShowMainWindowTitlebar,
  );
  const handleToggleAlwaysShowMainWindowTitlebar = usePlayerChromeSettingsStore(
    (state) => state.handleToggleAlwaysShowMainWindowTitlebar,
  );
  const electron = window.electron;
  const isMac = electron?.platform === "darwin";
  const usesNativeFullscreen =
    isMac && (useNativeMacFullscreenButton || isFullscreen);
  const isExpanded = usesNativeFullscreen ? isFullscreen : isMaximized;

  useEffect(() => {
    if (!electron) return;
    let active = true;
    let fullscreenEventReceived = false;
    const unsubscribe = electron.onWindowFullscreenChanged((fullscreen) => {
      fullscreenEventReceived = true;
      if (active) setIsFullscreen(fullscreen);
    });
    const checkMaximized = async () => {
      const maximized = await electron.isWindowMaximized();
      if (active) setIsMaximized(maximized);
    };
    const checkFullscreen = async () => {
      const fullscreen = await electron.isWindowFullscreen();
      if (active && !fullscreenEventReceived) setIsFullscreen(fullscreen);
    };
    void checkMaximized();
    void checkFullscreen();
    window.addEventListener("resize", checkMaximized);
    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener("resize", checkMaximized);
    };
  }, [electron]);

  // 三个可见性开关统一由这一处决定：固定时始终可见；没固定时看标题栏是否被叫出、或指针是否停在按钮上。
  // 触控按住期间也算可见：手指拖动会离开控制栏矩形，不能因此在按住的中途把按钮收起来。
  const controlsVisible =
    !isMainWindowClickThroughEnabled &&
    (isTitlebarPinned || revealed || isPointerInside || isTouchPressed);

  // 没固定时，光标进入控制栏所在的矩形就显示按钮（按钮此刻是透明的、不可点，所以不能用元素事件），
  // 移开就收起。用坐标判定而不是依赖 pointer-events，隐藏状态下也能被叫出来。
  useEffect(() => {
    if (isTitlebarPinned || isMainWindowClickThroughEnabled) {
      setIsPointerInside(false);
      return;
    }
    const handleMove = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      setIsPointerInside((prev) => (prev === inside ? prev : inside));
    };
    window.addEventListener("pointermove", handleMove);
    return () => {
      window.removeEventListener("pointermove", handleMove);
    };
  }, [isTitlebarPinned, isMainWindowClickThroughEnabled]);

  if (!electron) return null;

  const remoteControlVisible = controlsVisible;
  const standardControlsVisible = controlsVisible;
  const remoteBtnClass = `flex items-center justify-center w-9 h-[calc(100% - 6px)] mb-[6px] mr-[1px] transition-all bg-[linear-gradient(135deg,#fffa_20%,transparent)] hover:bg-[#307aa9] border-[1px] border-[#fff7] border-solid duration-200 text-white outline outline-1 outline-solid outline-[rgba(40,40,40,0.5)] shadow-[2px_2px_8px_2px_rgba(40,40,40,0.4)] ${
    remoteControlVisible
      ? isDaylight
        ? "pointer-events-auto translate-y-0"
        : "pointer-events-auto translate-y-0"
      : "pointer-events-none opacity-0 -translate-y-1"
  }`;
  const btnClass = `flex items-center justify-center w-11 h-[calc(100% - 6px)] mb-[6px] mr-[1px] bg-[linear-gradient(135deg,#fffa_20%,transparent)] hover:bg-[#307aa9] transition-all border-[1px] border-[#fff7] border-solid duration-200 text-white outline outline-1 outline-solid outline-[rgba(40,40,40,0.5)] shadow-[2px_2px_8px_2px_rgba(40,40,40,0.4)] ${
    standardControlsVisible
      ? isDaylight
        ? "pointer-events-auto translate-y-0"
        : "pointer-events-auto translate-y-0"
      : "pointer-events-none opacity-0 -translate-y-1"
  }`;
  const pinBtnClass = `${remoteBtnClass} ${
    isTitlebarPinned ? "bg-[#307aa9] shadow-[inset_0_0_0_1px_#fff8]" : ""
  }`;
  const closeBtnClass = `flex items-center justify-center w-11 h-[calc(100% - 6px)] mb-[6px] mr-[3px] bg-[linear-gradient(135deg,#a97874aa_20%,#cc361ccc)] hover:bg-[#cc361c] transition-all border-[1px] border-[#fff7] border-solid duration-200 text-white outline outline-1 outline-solid outline-[rgba(40,40,40,0.5)] shadow-[2px_2px_8px_2px_rgba(40,40,40,0.4)] ${
    standardControlsVisible
      ? isDaylight
        ? "pointer-events-auto translate-y-0"
        : "pointer-events-auto translate-y-0"
      : "pointer-events-none opacity-0 -translate-y-1"
  }`;

  // 手指划过的那个按钮上的 hover 光斑：以手指在按钮内的 Y 为中心，模拟鼠标 hover。
  // 用一层绝对定位的渐变而不是改按钮背景色，鼠标的 hover:bg-[#307aa9] 不受影响。
  const touchHoverOverlay = (control: ControlId) =>
    hoveredControl === control ? (
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle 26px at 50% ${hoverLocalY}px, ${
            control === "close" ? "#cc361c" : "#307aa9"
          }, transparent 100%)`,
        }}
      />
    ) : null;

  // 命中判定：按各按钮当前的 rect 找手指落在哪个按钮上（控制栏放大后 rect 也跟着放大），
  // 并把落点换算成按钮自己的布局坐标，hover 光斑才能贴着手指走。
  // 换算用按钮自己的 rect.height / offsetHeight，放大和果冻形变都一并折进去。
  const hitTest = (
    clientX: number,
    clientY: number,
  ): { control: ControlId; localY: number } | null => {
    const root = rootRef.current;
    if (!root) return null;
    const buttons = root.querySelectorAll<HTMLElement>("[data-control]");
    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        continue;
      }
      const control = button.dataset.control as ControlId | undefined;
      if (!control) continue;
      const scaleY =
        button.offsetHeight > 0 ? rect.height / button.offsetHeight : 1;
      return { control, localY: (clientY - rect.top) / (scaleY || 1) };
    }
    return null;
  };

  const applyHover = (clientX: number, clientY: number) => {
    const hit = hitTest(clientX, clientY);
    setHoveredControl(hit?.control ?? null);
    setHoverLocalY(hit?.localY ?? 0);
  };

  // 松手时按落在的那个按钮执行动作：和按钮自己的 onClick 走同一套调用，
  // 这样鼠标点击与触控拖动触发的结果一致，不需要在两处各写一份。
  const runControlAction = (control: ControlId) => {
    switch (control) {
      case "pin":
        handleToggleAlwaysShowMainWindowTitlebar(!isTitlebarPinned);
        break;
      case "remote":
        void electron.openRemoteControl?.();
        break;
      case "fullscreen":
        void electron.toggleFullscreenWindow();
        break;
      case "minimize":
        electron.minimizeWindow();
        break;
      case "maximize":
        if (usesNativeFullscreen) {
          void electron.toggleFullscreenWindow();
        } else {
          void electron.toggleMaximizeWindow().then(async () => {
            setIsMaximized(await electron.isWindowMaximized());
          });
        }
        break;
      case "close":
        electron.closeWindow();
        break;
    }
  };

  // 触控按下：整条控制栏放大到 1.5 倍，并记下手指位置。
  // 按下、拖动、松手都只在 rootRef 这一层判定：按在哪个按钮、按钮之间的空隙上都算。
  const handleTouchPressStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    touchActiveRef.current = true;
    swallowClickRef.current = false;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    setIsTouchPressed(true);
    // 抓住指针：手指划出按钮或划出控制栏，pointermove / pointerup 仍然回到 rootRef，不会半路丢失。
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // 放大落地（按下后第一帧）再算一次 hover：按下那一刻还是 1x 的几何，
  // 直接用会让高亮落在放大前的位置上。
  useEffect(() => {
    if (!isTouchPressed) return;
    const frame = requestAnimationFrame(() => {
      const point = lastPointerRef.current;
      if (point) applyHover(point.x, point.y);
    });
    return () => cancelAnimationFrame(frame);
  }, [isTouchPressed]);

  // 手指划到哪个按钮，那个按钮就高亮，光斑的 Y 跟着手指走。
  const handleTouchMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !touchActiveRef.current) return;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    applyHover(event.clientX, event.clientY);
  };

  // 手指抬起：按「松手时手指所在的位置」触发那个按钮的动作，然后回到 scale(1)。
  const finishTouchPress = (clientX: number, clientY: number) => {
    if (!touchActiveRef.current) return;
    touchActiveRef.current = false;
    lastPointerRef.current = null;
    const hit = hitTest(clientX, clientY);
    setIsTouchPressed(false);
    setHoveredControl(null);
    if (!hit) return;
    // 这次触摸已经由松手位置决定了动作，吞掉随后补上的 click，避免同一个按钮被执行两次。
    swallowClickRef.current = true;
    runControlAction(hit.control);
  };

  const handleTouchRelease = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishTouchPress(event.clientX, event.clientY);
  };

  // 触屏拖动时浏览器会接管手势并派发 pointercancel，那不代表松手：此时不能缩小，
  // 也不能在这里触发动作，改由 touchmove / touchend 继续跟手和收场。
  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // 触屏拖动时浏览器可能接管手势并派发 pointercancel，之后不再有 pointermove / pointerup；
  // 这里用 touch 事件兜底继续跟手和收场，保证拖动中一直放大、松手照样触发。
  const handleTouchMoveFallback = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (!touch || !touchActiveRef.current) return;
    lastPointerRef.current = { x: touch.clientX, y: touch.clientY };
    applyHover(touch.clientX, touch.clientY);
  };

  const handleTouchEndFallback = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    finishTouchPress(touch.clientX, touch.clientY);
  };

  // 被吞掉的那次 click 在捕获阶段拦下，按钮自己的 onClick 不会再执行。
  const handleClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  // 鼠标按在控制按钮上时告诉标题栏「按住中」：按住期间（哪怕指针滑出按钮、滑出顶部）
  // 都不自动收起，松手后按指针最后的位置重新判定，回到正常的自动显隐。
  const releaseHoldRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      // 组件卸载（切页、标题栏整体消失）时别把「按住中」留在 store 里。
      releaseHoldRef.current?.();
      setIsTitlebarHeld(false);
    },
    [setIsTitlebarHeld],
  );

  useGlass();
  return (
    // 外层只负责手势和果冻：data-glass-jelly 的每帧写入会直接改这个节点的 style.transform，
    // 所以 1.5 倍缩放放在里面的 content 层，两个 transform 各写各的，不再互相覆盖。
    // 果冻用「空串 / undefined」开关：布尔值会被 React 渲染成 data-glass-jelly="false"，
    // 属性仍在、选择器照样命中，等于永远开着。只有 undefined 才会真的摘掉属性。
    <div
      data-glass-jelly={isTitlebarPinned ? "" : undefined}
      ref={rootRef}
      className={`h-full ${
        isDaylight ? "text-zinc-800" : "text-[var(--text-primary)]"
      }`}
      onPointerDown={handleTouchPressStart}
      onPointerMove={handleTouchMove}
      onPointerUp={handleTouchRelease}
      onPointerCancel={handlePointerCancel}
      onTouchMove={handleTouchMoveFallback}
      onTouchEnd={handleTouchEndFallback}
      onTouchCancel={handleTouchEndFallback}
      onClickCapture={handleClickCapture}
      style={
        {
          WebkitAppRegion: "no-drag",
          pointerEvents: "none",
        } as React.CSSProperties
      }
    >
      <div
        className={`flex h-full origin-top-right transition-transform duration-200${
          isTouchPressed ? " scale-150" : ""
        }`}
      >
        <button
          data-glass
          data-glass-light
          data-glass-strength="0.8"
          data-glass-blur="1"
          data-glass-bend="5"
          data-control="pin"
          className={`relative ${pinBtnClass}`}
          tabIndex={standardControlsVisible ? 0 : -1}
          title={t(
            isTitlebarPinned ? "ui.unpinWindowControls" : "ui.pinWindowControls",
          )}
          aria-label={t(
            isTitlebarPinned ? "ui.unpinWindowControls" : "ui.pinWindowControls",
          )}
          aria-pressed={isTitlebarPinned}
          onClick={() =>
            handleToggleAlwaysShowMainWindowTitlebar(!isTitlebarPinned)
          }
        >
          {touchHoverOverlay("pin")}
          {isTitlebarPinned ? (
            <PinOff className="relative drop-shadow-[0_0_1px_#000]" size={14} />
          ) : (
            <Pin className="relative drop-shadow-[0_0_1px_#000]" size={14} />
          )}
        </button>
        <button
          data-glass
          data-glass-strength="0.8"
          data-glass-blur="1"
          data-glass-bend="5"
          data-control="remote"
          className={`relative ${remoteBtnClass}`}
          title={t("ui.remoteControl")}
          tabIndex={remoteControlVisible ? 0 : -1}
          onClick={() => void electron.openRemoteControl?.()}
        >
          {touchHoverOverlay("remote")}
          <Radio className="relative drop-shadow-[0_0_1px_#000]" size={15} />
        </button>
        {!hideFullscreenButton && (
          <button
            data-glass
            data-glass-strength="0.8"
            data-glass-blur="1"
            data-glass-bend="5"
            data-control="fullscreen"
            className={`relative ${remoteBtnClass}`}
            tabIndex={standardControlsVisible ? 0 : -1}
            title={t(isFullscreen ? "ui.exitFullscreen" : "ui.enterFullscreen")}
            aria-label={t(
              isFullscreen ? "ui.exitFullscreen" : "ui.enterFullscreen",
            )}
            onClick={() => void electron.toggleFullscreenWindow()}
          >
            {touchHoverOverlay("fullscreen")}
            {isFullscreen ? (
              <Minimize
                className="relative drop-shadow-[0_0_1px_#000]"
                size={13}
              />
            ) : (
              <Maximize
                className="relative drop-shadow-[0_0_1px_#000]"
                size={13}
              />
            )}
          </button>
        )}
        <button
          data-glass
          data-glass-strength="0.8"
          data-glass-blur="1"
          data-glass-bend="5"
          data-control="minimize"
          className={`relative ${btnClass}`}
          tabIndex={standardControlsVisible ? 0 : -1}
          onClick={() => electron.minimizeWindow()}
        >
          {touchHoverOverlay("minimize")}
          <Minus className="relative drop-shadow-[0_0_1px_#000]" size={16} />
        </button>
        {/* 全屏状态下不显示最大化 / 还原按钮：全屏时它只会和全屏按钮重复，
            而且「还原」在全屏里没有意义。 */}
        {!isFullscreen && (
          <button
            data-glass
            data-glass-strength="0.8"
            data-glass-blur="1"
            data-glass-bend="5"
            data-control="maximize"
            className={`relative ${btnClass}`}
            tabIndex={standardControlsVisible ? 0 : -1}
            title={t(
              usesNativeFullscreen
                ? isExpanded
                  ? "ui.exitFullscreen"
                  : "ui.enterFullscreen"
                : isExpanded
                  ? "ui.restoreWindow"
                  : "ui.maximizeWindow",
            )}
            aria-label={t(
              usesNativeFullscreen
                ? isExpanded
                  ? "ui.exitFullscreen"
                  : "ui.enterFullscreen"
                : isExpanded
                  ? "ui.restoreWindow"
                  : "ui.maximizeWindow",
            )}
            onClick={async () => {
              if (usesNativeFullscreen) {
                await electron.toggleFullscreenWindow();
              } else {
                await electron.toggleMaximizeWindow();
                setIsMaximized(await electron.isWindowMaximized());
              }
            }}
          >
            {touchHoverOverlay("maximize")}
            {usesNativeFullscreen ? (
              isExpanded ? (
                <Minimize
                  className="relative drop-shadow-[0_0_1px_#000]"
                  size={13}
                />
              ) : (
                <Maximize
                  className="relative drop-shadow-[0_0_1px_#000]"
                  size={13}
                />
              )
            ) : isExpanded ? (
              <Copy
                className="relative drop-shadow-[0_0_1px_#000]"
                size={13}
              />
            ) : (
              <Square
                className="relative drop-shadow-[0_0_1px_#000]"
                size={13}
              />
            )}
          </button>
        )}
        <button
          data-glass
          data-glass-strength="0.8"
          data-glass-blur="1"
          data-glass-bend="5"
          data-control="close"
          className={`relative ${closeBtnClass}`}
          tabIndex={standardControlsVisible ? 0 : -1}
          onClick={() => electron.closeWindow()}
        >
          {touchHoverOverlay("close")}
          <X className="relative drop-shadow-[0_0_1px_#000]" size={16} />
        </button>
      </div>
    </div>
  );
}
