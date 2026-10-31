import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useMotionValueEvent } from "framer-motion";
import { useTranslation } from "react-i18next";
import { playerBottomBarLiveOffset } from "../../stores/motionSignals";
import type { LibraryAccountController } from "../../library/core/account/account.contract";
import { useLibraryAccountProviders } from "../../library/core/account/useLibraryAccount";
import {
  PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
  resolvePlayerBottomComponentBottomPx,
} from "../../utils/playerBottomBarLayout";
import { Tooltip } from "../modal/settings/kit";
import {
  settingsTokens,
  useSettingsKitTheme,
} from "../modal/settings/kit/kitTheme";
import {
  kitMotionTokens,
  useKitReducedMotion,
} from "../modal/settings/kit/motion";
import { openLoginWindow, useLoginWindowStore } from "./loginWindowStore";
import { AccountPicture, PlatformMark } from "./PlatformMark";
import {
  pillProvider,
  pillSeenNext,
  rowStatus,
  type PillSeen,
} from "./platformRows";

// src/components/login/SwitcherPill.tsx
// 主页右下角的切换器：正在用的账号的头像，角上是平台的记号（没有人登录时只有记号；登录失效时记号上
// 一个黄点），旁边是返回播放器的按钮。点头像打开登录窗口，开在正在用的平台上；换平台、退出登录都在
// 那个窗口里。换了平台或者登录之后，平台的名字在头像旁边展开，停 1.8 秒再收回去。

/** 名字展开着的时间。 */
const LABEL_STAYS_MS = 1800;

type SwitcherPillProps = {
  /** 平台和它们的账号来自账户 controller。 */
  account: LibraryAccountController;
  onBackToPlayer: () => void;
};

const SwitcherPill: React.FC<SwitcherPillProps> = ({
  account,
  onBackToPlayer,
}) => {
  const { t } = useTranslation();
  const { providers, activeProviderId } = useLibraryAccountProviders(account);
  const { isDaylight, theme } = useSettingsKitTheme();
  const reduced = useKitReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const baseBottomPxRef = useRef(16);
  const provider = pillProvider(providers, activeProviderId);
  const status = provider ? rowStatus(provider) : "signed-out";

  /**
   * 默认高度保留原 CSS（`bottom-4 md:bottom-6`），只有真的产生抬升量时才写内联 bottom。
   *
   * 不是洁癖：把位置常驻交给 motion 的 style 会给这一层加上 will-change，元素被提升成
   * 独立合成层，文字栅格化随之改变 —— app.screenshot 的 local-library 基线能直接照出来。
   */
  const syncBottomOffset = useCallback((globalOffsetPx: number) => {
    const root = rootRef.current;
    if (!root) return;
    if (globalOffsetPx === PLAYER_BOTTOM_BAR_BASE_OFFSET_PX) {
      root.style.removeProperty("bottom");
      return;
    }
    root.style.bottom = `${resolvePlayerBottomComponentBottomPx(globalOffsetPx, baseBottomPxRef.current)}px`;
  }, []);

  useMotionValueEvent(playerBottomBarLiveOffset, "change", syncBottomOffset);

  /** 先撤掉内联值量回 CSS 里的原始底距（断点会改它），再按当前抬升量重写。 */
  const measureAndSync = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.removeProperty("bottom");
    const measured = Number.parseFloat(getComputedStyle(root).bottom);
    baseBottomPxRef.current = Number.isFinite(measured) ? measured : 16;
    syncBottomOffset(playerBottomBarLiveOffset.get());
  }, [syncBottomOffset]);

  /**
   * 用 callback ref 而不是挂载时的 layout effect：providers 还没到位时下面会 return null，
   * 那一次 effect 拿到的 ref 是空的，而它不会再跑第二遍 —— 切换器就会一直停在原位，
   * 底部其他组件却已经抬起来了。节点真正出现时才量，才不会有这个空窗。
   */
  const setRootNode = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (node) {
        measureAndSync();
      }
    },
    [measureAndSync],
  );

  // 断点跨过去时 CSS 里的原始底距会变，重量一次。
  useEffect(() => {
    window.addEventListener("resize", measureAndSync);
    return () => window.removeEventListener("resize", measureAndSync);
  }, [measureAndSync]);

  // 这里画的这个平台刚确认了一次登录、动画还没放完：头像要从窗口飞过来，落下之前这里先不画它，名字也等它
  // 落下再展开。正在登录的是别的平台时，这里什么都不变。
  const shownId = provider?.providerId;
  const landing = useLoginWindowStore(
    (state) => state.landing !== null && state.landing === shownId,
  );

  // 换了平台，或者这个平台刚登录上：名字展开一会儿（规则在 pillSeenNext）。
  const signedIn = status === "signed-in";
  const known = provider !== null && provider.status !== "unknown";
  const previousRef = useRef<PillSeen>({ shownId, signedIn, known });
  const labelTimerRef = useRef<number | undefined>(undefined);
  const [showLabel, setShowLabel] = useState(false);
  useEffect(() => {
    const next = pillSeenNext(
      previousRef.current,
      { shownId, signedIn, known },
      landing,
    );
    previousRef.current = next.seen;
    if (!next.unfolds) return;
    setShowLabel(true);
    window.clearTimeout(labelTimerRef.current);
    labelTimerRef.current = window.setTimeout(
      () => setShowLabel(false),
      LABEL_STAYS_MS,
    );
  }, [shownId, signedIn, known, landing]);
  useEffect(() => () => window.clearTimeout(labelTimerRef.current), []);

  if (!provider) return null;

  return (
    <div
      ref={setRootNode}
      data-testid="online-provider-switcher"
      className="pointer-events-auto absolute bottom-4 right-4 z-[8] md:bottom-6 md:right-6"
      style={
        {
          ...settingsTokens(isDaylight, theme),
          ...kitMotionTokens(reduced),
          "--login-edge": "var(--st-menu)",
        } as React.CSSProperties
      }
    >
      <div
        data-glass
        data-glass-jelly
        data-glass-light
        className="flex items-center rounded-[26px] p-0.5 text-[color:var(--st-t1)] shadow-lg md:p-1.5"
        style={{
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
      >
        <Tooltip text={t("home.switchOnlineProvider")} className="inline-flex">
          <button
            type="button"
            onClick={(event) =>
              openLoginWindow(
                provider.providerId,
                event.currentTarget.querySelector("[data-login-pill]"),
              )
            }
            aria-label={t("home.switchOnlineProvider")}
            className="st-t-fast flex h-10 min-w-10 items-center rounded-full transition-colors"
          >
            {/* 登录窗口从这里出来，登录成功后头像飞回这里（done/LoginDone.tsx 按这个属性找它，属性的值是这里画的平台）。 */}
            <span
              data-login-pill={provider.providerId}
              className="inline-flex"
              style={
                landing && status === "signed-in" ? { opacity: 0 } : undefined
              }
            >
              {status === "signed-in" && provider.user ? (
                <AccountPicture
                  user={provider.user}
                  size={40}
                  providerId={provider.providerId}
                />
              ) : (
                <PlatformMark
                  providerId={provider.providerId}
                  label={provider.shortName}
                  size={40}
                  ranOut={status === "ran-out"}
                />
              )}
            </span>
            <span
              className={`st-t-move overflow-hidden whitespace-nowrap text-xs font-semibold transition-[max-width,opacity,padding] ${showLabel ? "max-w-[180px] pl-2.5 pr-3 opacity-100" : "max-w-0 opacity-0"}`}
            >
              {provider.shortName || provider.displayName}
            </span>
          </button>
        </Tooltip>
        <span
          className="mx-1.5 hidden h-6 w-px bg-[var(--st-line2)] md:block"
          aria-hidden="true"
        />
        <Tooltip
          text={t("home.backToPlayer")}
          className="hidden md:inline-flex"
        >
          <button
            type="button"
            onClick={onBackToPlayer}
            aria-label={t("home.backToPlayer")}
            className="st-t-fast flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--st-fill)]"
          >
            <ChevronRight size={21} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
};

export default SwitcherPill;
