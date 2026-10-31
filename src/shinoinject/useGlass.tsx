import { useLayoutEffect } from "react";
import { installGlassJelly, installGlassLight, makeGlass } from "./liquidglass.ts";

// src/mods/useGlass.tsx
// React 侧的挂玻璃入口。渲染体里的 querySelectorAll 跑在本次 commit 之前，条件渲染的面板
// （工具面板、悬浮控制条、弹层）只能等别的组件碰巧重新渲染才被扫到，表现为「几秒后才出玻璃」。
// 挪进 useLayoutEffect：每次 commit 后、绘制前同步扫一遍，首帧就挂上；makeGlass 幂等，重复扫没有代价。
// installGlassJelly 幂等：window 级拖拽果冻监听只装一次，带 data-glass-jelly 的玻璃才参与。
// installGlassLight 同理：window 级拖拽光效监听只装一次，带 data-glass-light 的元素才参与（不依赖 data-glass）。
export const useGlass = (selector = "[data-glass]") => {
  useLayoutEffect(() => {
    document.querySelectorAll<HTMLElement>(selector).forEach(makeGlass);
    installGlassJelly();
    installGlassLight();
  });
};

// 玻璃滤镜的注入容器：全应用只挂一份（App 根部），id 固定 filter-defs。
// liquidglass 的 getDefs 优先往这里塞 <filter>，别的代码也往这一处注入即可。
// 必须常驻——卸载会连同已建的 <filter> 一起摘掉，url(#lg-N) 悬空，玻璃整体消失。
export const GlassFilterDefs = () => (
  <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
    <defs id="filter-defs"></defs>
  </svg>
);
