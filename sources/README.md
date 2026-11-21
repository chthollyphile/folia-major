# sources/

Folia 的内置音源模组（Folium 2.0，方案 `dev/folium/folium-2-plan.md` §6）。每个子目录是一家平台，目录名就是它的短音源 id
（如 `bodian`、`appleMusic`，也是受信表 `electron/modSystem/builtinSources.cjs` 里那一行认领的 id）。九家都已经从
`src/services/onlineMusic/<id>/` 和 `electron/<id>/` 迁到这里，宿主不再静态注册任何一家；那两处旧路径作废。第十家 `lxmusic`（洛雪音源）是直接在这里写的，没有旧路径。

- 音源模组怎么写（清单 `sources[]`、能力、`playback.surface`、main 入口的 `api`）：[`docs/folium/sources.md`](../docs/folium/sources.md)；
  签名以生成的 [`docs/folium/api.md`](../docs/folium/api.md) 为准。往仓库里加一家的步骤：`src/services/onlineMusic/README.md` 的「接入一个新平台」。
- 布局、构建、依赖的声明与做法、安装包带哪几家：`dev/sources/README.md`（`npm run sources:build` 构建到 `dist-mods/`）。
- 每家的 `README.md` 写它靠哪个上游、版本钉在哪、我们改了什么、上游变了怎么跟（原 `UPSTREAMS.md` 里那一节）。
- 只用公开接口：不 import `src/`、`electron/`（Dedicatus D130），只对着 `mods/folium.d.ts`（`@folia/folium`）和
  `packages/folium-source-kit`（`@folia/folium-source-kit`）编译（这里的 `tsconfig.json`，`npm run typecheck` 跑它）。
  宿主只有 `src/services/onlineMusic/web/*` 可以 import `sources/*/core`（D131）。
- 清单要过内置清单校验（`dev/sources/manifestCheck.mjs`，`test/unit/sources/builtinManifests.test.ts`）：模组 id 在受信表里，
  目录名是那一行的短 id，四种语言的名字齐全，`zh-TW.json` 不手写，不带签名文件。内置副本不签名，改了不用重签。
- 单测里由 `test/unit/helpers/builtinSources.ts`（vitest 的 setupFiles）给第一行写了 `// @builtin-sources` 的测试文件注册：
  有 `core/index.ts` 的 `createSource` 就用测试 env 调它，否则调 `client/index.ts` 的 `activate`；到 main 入口的调用由测试用
  `setBuiltinSourceRpc` 接住。测试仍放 `test/unit/`。
- 桌面上拿不到真账号时，`test/manual/fakeSourceNetwork/` 给一家写张路由表就能把它的网络换成假应答（验证管道，不验证真实接口）。
