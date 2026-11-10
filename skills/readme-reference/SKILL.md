---
name: readme-reference
description: Use when making code, workflow, testing, deployment, or documentation changes in this repository and you need targeted project-specific facts from README files before editing. Read only the relevant section, verify it against code, and repair stale documentation when the task includes documentation.
---

# README Reference

README 是导航线索，不是代码真相。先按任务读取相关小片段，再用 tracked paths、imports、package scripts 和实现文件确认；发现旧路径时顺手修正文档或明确标记它。

## Source selection

- 产品能力、脚本、Electron、Vercel、API：`README.md`。
- `src/` 入口、模块职责、app-level 装配：`src/README.md`。
- visualizer 共享入口、模式、背景、性能约定，以及加一个歌词动画样式的清单：`src/components/visualizer/README.md`。
- Partita layout、sticky punctuation、预热和缓存：`src/components/visualizer/partita/README.md`；Tempera：`src/components/visualizer/tempera/README.md`。
- 在线歌曲 Omni/provider 边界、各平台的实测记录、接入一个新平台的清单：`src/services/onlineMusic/README.md` + `src/services/onlineMusic/omni.ts`；平台接入探索页：`src/services/onlineMusic/EXPLORE_ADAPTER.md`。
- 歌词样式和背景的性能测量：`dev/perf/README.md`。
- 自动混音：`src/services/automix/README.md`。
- 同步 API、Node/Cloudflare/Docker 部署：`sync-server/README.md`。
- Docker Web stack、端口、环境变量和 smoke test：`deploy/docker/README.md`。
- Linux 便携包和 Electron 图形模式：`packaging/linux/README-LINUX.txt` + `electron/main.cjs`。
- Cappella 内置头像/表情资源：相邻 `cappella/avatar/README.md` 或 `emo/README.md`，只在涉及这些资源时读取。
- `test/manual/**/README.md` 属于测试/联调文档；按“排除测试文件”的任务要求不要把它们当作生产架构依据。

## Targeted reading

先用 `rg -n` 搜标题、脚本名、当前符号或路径，再打开命中位置附近 20-80 行。不要为了保险全文读取长 README。

```powershell
rg -n "components/app|services/|visualizer|scripts|部署|Node|Docker" src/README.md README.md
rg -n "VisualizerRenderer|registry|pendolo|sonnet|background" src/components/visualizer/README.md
rg -n "Omni|provider|lyrics|playback|catalog" src/services/onlineMusic/README.md
rg -n "Node|/health|/settings|/themes|compose" sync-server/README.md deploy/docker/README.md
```

## Verification protocol

1. 文档给出路径时，用 `git ls-files -- <path>` 验证路径存在。
2. 文档给出脚本时，核对根 `package.json`、领域 `package.json` 和 `vite.config.*` / `wrangler.*`。
3. 文档给出入口时，先看该文件的 imports 和 export，再沿一层调用关系，不要直接扫描整个目录。
4. 文档给出 API 时，核对 `sync-server/src/app.ts`、`worker/index.ts`、`api/` 或对应 bridge。
5. 文档给出 provider 能力时，先看 `src/services/onlineMusic/omni.ts` 和 `src/types/onlineMusic.ts`，再看 adapter/transport。
6. 代码与 README 冲突时，以代码为准，并在本次文档改动中更新对应说明。

## Repository-specific traps

- 当前 app-level 目录是 `src/components/app/*`。已经删掉、但旧文档里还会出现的页面和名字，见 `skills/codebase-navigation/SKILL.md` 的“这些名字已经不是当前入口”。
- Visualizer 模式由 `src/components/visualizer/registry.tsx` 从各模式 `entry.tsx` 发现；内建样式的 id 清单是 `src/types/visualizerModes.ts` 的 `BUILTIN_VISUALIZER_MODES`，不要按文档里抄的列表理解。
- 在线歌曲普通调用必须经过 `src/services/onlineMusic/omni.ts`；Navidrome 是独立 `src/services/navidromeService.ts`，不能仅凭“在线”一词混为一谈。
- `src/App.tsx` 是历史大型编排文件；README 只提供入口关系，不代表新逻辑应继续写入其中。
- Sync Server 的 Node engine 当前以 `sync-server/package.json` 和根 `package.json` 为准，不要复制旧的 Node 18 说明。

## Editing rules

- 只更新与当前代码/部署状态有关的段落；保持 README 可搜索、短路径明确。
- 不要把完整源代码或大段接口响应复制进 README；给出第一入口和下一层即可。
- 保留所有 `@note` 注释原文，不翻译、不缩短、不删除。
- 文档任务的验证重点是路径、符号、命令、端口和配置值；不要为了 README 改动误跑完整构建。
