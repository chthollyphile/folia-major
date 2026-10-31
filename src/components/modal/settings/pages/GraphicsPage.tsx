import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import ConfirmDialog from "../../../shared/ConfirmDialog";
import {
  MOTION_SURFACE_IDS,
  useMotionSettingsStore,
  type MotionSurfaceId,
} from "../../../../stores/useMotionSettingsStore";
import { useDesktopSettingsStore } from "../../../../stores/useDesktopSettingsStore";
import { usePlayerChromeSettingsStore } from "../../../../stores/usePlayerChromeSettingsStore";
import { useThemeSettingsStore } from "../../../../stores/useThemeSettingsStore";
import { useVisualizerSettingsStore } from "../../../../stores/useVisualizerSettingsStore";
import { useLiquidGlassSettingsStore } from "../../../../stores/useLiquidGlassSettingsStore";
import {
  LIQUID_GLASS_PARAM_BOUNDS,
  LIQUID_GLASS_PRESETS,
  LIQUID_GLASS_DISTORTION_SUPPORTED,
  LIQUID_GLASS_BLOCKED_BY_GPU_PREFERENCE,
  type LiquidGlassPresetId,
} from "../../../../shinoinject/liquidglass";
import { VISUALIZER_FRAME_RATE_OPTIONS } from "../../../../utils/frameRateLimiter";
import {
  Group,
  Link,
  Reveal,
  Row,
  Segmented,
  Slider,
  Toggle,
  option,
  useSettingsKitTheme,
  type SettingsGroupDef,
  type SettingsOptionDef,
} from "../kit";
import { GlassPresetGrid } from "./pictures";
import { GpuPreferenceRow } from "./graphics/GpuPreferenceRow";
import { useSettingsPage } from "./settingsPageContext";

// src/components/modal/settings/pages/GraphicsPage.tsx
// The 性能与动效 page: what trades picture for smoothness or works around a renderer problem
// (static mode, the home background, native blur, the frame-rate cap, the lyric canvas resolution and
// anti-aliasing every canvas / WebGL lyric style follows by default, background throttling, the
// Linux glow fix, the Windows render GPU), and which parts of the interface play reduced motion.

/** Docs page behind the "Fix lyric animation freeze on Linux" switch. */
const CHROMIUM_FD_EXHAUSTION_DOCS_URL =
  "https://folia-site.cielaniska.top/guide/chromium-fd-exhaustion";

/** The rate the frame-rate cap starts at when it is switched on. */
const FRAME_RATE_WHEN_SWITCHED_ON = 120;

/** Native blur is not offered on Linux. */
const IS_LINUX =
  typeof navigator !== "undefined" &&
  navigator.userAgent.toLowerCase().includes("linux");

/** The render GPU choice only does something in the Windows desktop app (electron/gpuPreference.cjs). */
const IS_WINDOWS_DESKTOP =
  typeof window !== "undefined" && window.electron?.platform === "win32";

const PERFORMANCE: SettingsGroupDef = {
  id: "graphicsPerformance",
  titleKey: "options.labPerformanceSection",
};
const MOTION: SettingsGroupDef = {
  id: "graphicsMotion",
  titleKey: "options.reduceMotionSection",
};
const GLASS: SettingsGroupDef = {
  id: "liquidGlass",
  titleKey: "options.liquidGlassSection",
};

/** 扭曲与饱和度只在画得了位移图的渲染器上可调（Chromium 内核；Safari 与 iOS 上的浏览器除外）。 */
const GLASS_DISTORTION = LIQUID_GLASS_DISTORTION_SUPPORTED;

/** 渲染显卡选了「省电」GPU 时流体玻璃整体停用（见 liquidglass.ts），整组设置只读并说明原因。 */
const GLASS_GPU_BLOCKED = LIQUID_GLASS_BLOCKED_BY_GPU_PREFERENCE;

const O = {
  glassPreset: option(GLASS, "liquidGlassPreset", "options.liquidGlassPreset"),
  staticMode: option(
    PERFORMANCE,
    "enableStaticMode",
    "options.enableStaticMode",
  ),
  homeBackground: option(
    PERFORMANCE,
    "disableHomeDynamicBackground",
    "options.disableHomeDynamicBackground",
  ),
  nativeBlur: option(
    PERFORMANCE,
    "enablePlayerPageNativeBlur",
    "options.enablePlayerPageNativeBlur",
  ),
  frameRate: option(
    PERFORMANCE,
    "visualizerFrameRate",
    "options.visualizerFrameRate",
  ),
  frameRateValue: option(
    PERFORMANCE,
    "visualizerFrameRateValue",
    "options.visualizerFrameRateValue",
  ),
  backgroundThrottling: option(
    PERFORMANCE,
    "backgroundThrottling",
    "options.backgroundThrottling",
    { electronOnly: true },
  ),
  glowFix: option(PERFORMANCE, "glowBlurQuantize", "options.glowBlurQuantize"),
  gpuPreference: option(PERFORMANCE, "gpuPreference", "options.gpuPreference", {
    electronOnly: true,
    available: () => IS_WINDOWS_DESKTOP,
  }),
  followSystem: option(
    MOTION,
    "reduceMotionFollowSystem",
    "options.reduceMotionFollowSystem",
  ),
  glassStrength: option(
    GLASS,
    "liquidGlassStrength",
    "options.liquidGlassStrength",
    { available: () => GLASS_DISTORTION },
  ),
  glassBend: option(GLASS, "liquidGlassBend", "options.liquidGlassBend", {
    available: () => GLASS_DISTORTION,
  }),
  glassBlur: option(GLASS, "liquidGlassBlur", "options.liquidGlassBlur"),
  glassSat: option(GLASS, "liquidGlassSat", "options.liquidGlassSat", {
    available: () => GLASS_DISTORTION,
  }),
  glassLight: option(GLASS, "liquidGlassLight", "options.liquidGlassLight"),
  glassJelly: option(GLASS, "liquidGlassJelly", "options.liquidGlassJelly"),
};

/** One row per part of the interface whose motion can be reduced, in the store's order. */
const SURFACE_ROWS: Record<
  MotionSurfaceId,
  { option: SettingsOptionDef; hintKey: string }
> = {
  lattice: {
    option: option(
      MOTION,
      "reduceMotionLattice",
      "options.reduceMotionLattice",
    ),
    hintKey: "options.reduceMotionLatticeDesc",
  },
  transitionOverlay: {
    option: option(
      MOTION,
      "reduceMotionTransitionOverlay",
      "options.reduceMotionTransitionOverlay",
    ),
    hintKey: "options.reduceMotionTransitionOverlayDesc",
  },
  collectionMorph: {
    option: option(
      MOTION,
      "reduceMotionCollectionMorph",
      "options.reduceMotionCollectionMorph",
    ),
    hintKey: "options.reduceMotionCollectionMorphDesc",
  },
  monetBackground: {
    option: option(
      MOTION,
      "reduceMotionMonetBackground",
      "options.reduceMotionMonetBackground",
    ),
    hintKey: "options.reduceMotionMonetBackgroundDesc",
  },
  uiMicroMotion: {
    option: option(
      MOTION,
      "reduceMotionUiMicroMotion",
      "options.reduceMotionUiMicroMotion",
    ),
    hintKey: "options.reduceMotionUiMicroMotionDesc",
  },
  settingsScroll: {
    option: option(
      MOTION,
      "reduceMotionSettingsScroll",
      "options.reduceMotionSettingsScroll",
    ),
    hintKey: "options.reduceMotionSettingsScrollDesc",
  },
};

export const OPTIONS: SettingsOptionDef[] = [
  ...Object.values(O).filter((row) => row !== O.nativeBlur || !IS_LINUX),
  ...MOTION_SURFACE_IDS.map((surface) => SURFACE_ROWS[surface].option),
];
const FRAME_RATE_CHOICES = VISUALIZER_FRAME_RATE_OPTIONS.map((rate) => ({
  value: String(rate),
  label: `${rate} FPS`,
}));

/** 预设名走 i18n（三份语言文件一起加），效果图占位见 GlassPresetPicture。 */
const PRESET_LABEL_KEY: Record<LiquidGlassPresetId, string> = {
  frosted: "options.liquidGlassPresetFrosted",
  clear: "options.liquidGlassPresetClear",
  hazy: "options.liquidGlassPresetHazy",
  eco: "options.liquidGlassPresetEco",
};

const GraphicsPage: React.FC = () => {
    const { t } = useTranslation();
  const { isDaylight } = useSettingsKitTheme();
  const { isElectron } = useSettingsPage();
  
  // 1. 保留主分支的代码格式，并合并你的液态玻璃 store
  const theme = useThemeSettingsStore(
    useShallow((state) => ({
      staticMode: state.staticMode,
      homeBackgroundOff: state.disableHomeDynamicBackground,
      setStaticMode: state.handleToggleStaticMode,
      setHomeBackgroundOff: state.handleToggleDisableHomeDynamicBackground,
    })),
  );
  const nativeBlur = usePlayerChromeSettingsStore(
    (state) => state.enablePlayerPageNativeBlur,
  );
  const setNativeBlur = usePlayerChromeSettingsStore(
    (state) => state.handleTogglePlayerPageNativeBlur,
  );
  const backgroundThrottling = useDesktopSettingsStore(
    (state) => state.backgroundThrottling,
  );
  const setBackgroundThrottling = useDesktopSettingsStore(
    (state) => state.handleToggleBackgroundThrottling,
  );
  
  // 2. 融合 visualizer：加入主分支新增的 renderQuality 逻辑
  const visualizer = useVisualizerSettingsStore(
    useShallow((state) => ({
      frameRate: state.visualizerFrameRate,
      glowFix: state.glowBlurQuantize,
      setFrameRate: state.handleSetVisualizerFrameRate,
      setGlowFix: state.handleToggleGlowBlurQuantize,
      renderQuality: state.lyricRenderQuality,             // 新增：来自 main
      setRenderQuality: state.handleSetLyricRenderQuality, // 新增：来自 main
    })),
  );
  const motion = useMotionSettingsStore(
    useShallow((state) => ({
      surfaces: state.reducedMotionSurfaces,
      followSystem: state.followSystemReducedMotion,
      systemPrefers: state.systemPrefersReducedMotion,
      setSurface: state.handleToggleReducedMotionSurface,
      setFollowSystem: state.handleToggleFollowSystemReducedMotion,
    })),
  );

  // 3. 保留你的液态玻璃设置 store
  const glass = useLiquidGlassSettingsStore(
    useShallow((state) => ({
      strength: state.strength,
      blur: state.blur,
      sat: state.sat,
      bend: state.bend,
      light: state.light,
      jelly: state.jelly,
      setStrength: state.handleSetLiquidGlassStrength,
      setBlur: state.handleSetLiquidGlassBlur,
      setSat: state.handleSetLiquidGlassSat,
      setBend: state.handleSetLiquidGlassBend,
      setLight: state.handleSetLiquidGlassLight,
      setJelly: state.handleSetLiquidGlassJelly,
      setParams: state.handleSetLiquidGlassParams,
    })),
  );

  // Native blur can drop frames on some GPUs, so switching it on asks first.
  const [nativeBlurAsking, setNativeBlurAsking] = useState(false);
  const frameRateLimited = visualizer.frameRate !== "off";
  
  // 4. 保留你的液态玻璃预设计算逻辑
  // 预设：画不了位移图的平台不列出通透/朦胧流体；按当前值高亮（那边强度与弯曲距离被钉死，只按模糊匹配）。
  const presetOptions = LIQUID_GLASS_PRESETS.filter(
    (preset) => !preset.needsDistortion || GLASS_DISTORTION,
  ).map((preset) => ({
    value: preset.id as string,
    label: t(PRESET_LABEL_KEY[preset.id]),
  }));
  const activePreset =
    LIQUID_GLASS_PRESETS.find((preset) =>
      preset.needsDistortion && !GLASS_DISTORTION
        ? false
        : GLASS_DISTORTION
          ? glass.strength === preset.strength &&
            glass.blur === preset.blur &&
            glass.bend === preset.bend
          : glass.blur === preset.blur,
    )?.id ?? "";
  const applyPreset = (id: string) => {
    const preset = LIQUID_GLASS_PRESETS.find(
      (candidate) => candidate.id === id,
    if (preset)
      glass.setParams({
        strength: preset.strength,
        blur: preset.blur,
        bend: preset.bend,
      });
  };

  return (
    <>
      <Group def={PERFORMANCE}>
        <Row option={O.staticMode} hint={t("options.enableStaticModeDesc")}>
          <Toggle checked={theme.staticMode} onChange={theme.setStaticMode} />
        </Row>
        <Row
          option={O.homeBackground}
          hint={t("options.disableHomeDynamicBackgroundDesc")}
        >
          <Toggle
            checked={theme.homeBackgroundOff}
            onChange={theme.setHomeBackgroundOff}
          />
        </Row>
        {!IS_LINUX && (
          <Row
            option={O.nativeBlur}
            hint={t("options.enablePlayerPageNativeBlurHint")}
            note={t("options.enablePlayerPageNativeBlurDesc")}
          >
            <Toggle
              checked={nativeBlur}
              onChange={(enabled) =>
                enabled ? setNativeBlurAsking(true) : setNativeBlur(false)
              }
            />
          </Row>
        )}
        <Row option={O.frameRate} hint={t("options.visualizerFrameRateDesc")}>
          <Toggle
            checked={frameRateLimited}
            onChange={(enabled) =>
              visualizer.setFrameRate(
                enabled ? FRAME_RATE_WHEN_SWITCHED_ON : "off",
              )
            }
          />
        </Row>
        <Reveal when={frameRateLimited}>
          <Row sub option={O.frameRateValue}>
            <Segmented
              value={String(visualizer.frameRate)}
              options={FRAME_RATE_CHOICES}
              onChange={(value) => {
                const rate = VISUALIZER_FRAME_RATE_OPTIONS.find(
                  (candidate) => String(candidate) === value,
                );
                if (rate) visualizer.setFrameRate(rate);
              }}
            />
          </Row>
        </Reveal>
        {isElectron && (
          <Row
            option={O.backgroundThrottling}
            hint={t("options.backgroundThrottlingHint")}
            note={t("options.backgroundThrottlingDesc")}
          >
            <Toggle
              checked={backgroundThrottling}
              onChange={setBackgroundThrottling}
            />
          </Row>
        )}
        <Row
          option={O.glowFix}
          hint={
            <>
              {t("options.glowBlurQuantizeDesc")}{" "}
              <Link href={CHROMIUM_FD_EXHAUSTION_DOCS_URL}>
                {t("options.glowBlurQuantizeDocs")}
              </Link>
            </>
          }
        >
          <Toggle
            checked={visualizer.glowFix}
            onChange={visualizer.setGlowFix}
          />
        </Row>
        {IS_WINDOWS_DESKTOP && <GpuPreferenceRow option={O.gpuPreference} />}
      </Group>

      <Group def={MOTION} foot={t("options.reduceMotionSectionDesc")}>
        <Row
          option={O.followSystem}
          hint={t("options.reduceMotionFollowSystemDesc")}
        >
          <Toggle
            checked={motion.followSystem}
            onChange={motion.setFollowSystem}
          />
        </Row>
        {/* While the system asks for reduced motion and is followed, every row below is reduced whatever its switch says. */}
        <Reveal when={motion.followSystem && motion.systemPrefers}>
          <Row sub notice={t("options.reduceMotionForcedNotice")} />
        </Reveal>
        {MOTION_SURFACE_IDS.map((surface) => (
          <Row
            key={surface}
            option={SURFACE_ROWS[surface].option}
            hint={t(SURFACE_ROWS[surface].hintKey)}
          >
            <Toggle
              checked={motion.surfaces[surface]}
              onChange={(enabled) => motion.setSurface(surface, enabled)}
            />
          </Row>
        ))}
      </Group>

      <Group def={GLASS} foot={t("options.liquidGlassSectionDesc")}>
        {GLASS_GPU_BLOCKED && (
          <Row sub notice={t("options.liquidGlassGpuBlockedNotice")} />
        )}
        <Row
          option={O.glassPreset}
          disabled={GLASS_GPU_BLOCKED}
          hint={t("options.liquidGlassPresetDesc")}
          below={
            <GlassPresetGrid
              value={activePreset}
              label={t("options.liquidGlassPreset")}
              options={presetOptions}
              onChange={applyPreset}
            />
          }
        />
        {GLASS_DISTORTION && (
          <Row
            option={O.glassStrength}
            disabled={GLASS_GPU_BLOCKED}
            hint={t("options.liquidGlassStrengthDesc")}
          >
            <Slider
              value={glass.strength}
              min={LIQUID_GLASS_PARAM_BOUNDS.strength.min}
              max={LIQUID_GLASS_PARAM_BOUNDS.strength.max}
              step={0.25}
              onChange={glass.setStrength}
              format={(value) => value.toFixed(2)}
            />
          </Row>
        )}
        {GLASS_DISTORTION && (
          <Row
            option={O.glassBend}
            disabled={GLASS_GPU_BLOCKED}
            hint={t("options.liquidGlassBendDesc")}
          >
            <Slider
              value={glass.bend}
              min={LIQUID_GLASS_PARAM_BOUNDS.bend.min}
              max={LIQUID_GLASS_PARAM_BOUNDS.bend.max}
              step={2}
              onChange={glass.setBend}
              format={(value) => `${Math.round(value)}px`}
            />
          </Row>
        )}
        <Row
          option={O.glassBlur}
          disabled={GLASS_GPU_BLOCKED}
          hint={t("options.liquidGlassBlurDesc")}
        >
          <Slider
            value={glass.blur}
            min={LIQUID_GLASS_PARAM_BOUNDS.blur.min}
            max={LIQUID_GLASS_PARAM_BOUNDS.blur.max}
            step={0.5}
            onChange={glass.setBlur}
            format={(value) => value.toFixed(1)}
          />
        </Row>
        {GLASS_DISTORTION && (
          <Row
            option={O.glassSat}
            disabled={GLASS_GPU_BLOCKED}
            hint={t("options.liquidGlassSatDesc")}
          >
            <Slider
              value={glass.sat}
              min={LIQUID_GLASS_PARAM_BOUNDS.sat.min}
              max={LIQUID_GLASS_PARAM_BOUNDS.sat.max}
              step={5}
              onChange={glass.setSat}
              format={(value) => `${Math.round(value)}%`}
            />
          </Row>
        )}
        <Row
          option={O.glassLight}
          disabled={GLASS_GPU_BLOCKED}
          hint={t("options.liquidGlassLightDesc")}
        >
          <Toggle checked={glass.light} onChange={glass.setLight} />
        </Row>
        <Row
          option={O.glassJelly}
          disabled={GLASS_GPU_BLOCKED}
          hint={t("options.liquidGlassJellyDesc")}
        >
          <Toggle checked={glass.jelly} onChange={glass.setJelly} />
        </Row>
      </Group>

      <ConfirmDialog
        isOpen={nativeBlurAsking}
        isDaylight={isDaylight}
        title={t("options.nativeBlurConfirmTitle")}
        description={t("options.nativeBlurConfirmDesc")}
        confirmText={t("options.nativeBlurConfirmAction")}
        onConfirm={() => {
          setNativeBlur(true);
          setNativeBlurAsking(false);
        }}
        onClose={() => setNativeBlurAsking(false)}
      />
    </>
  );
};

export default GraphicsPage;
