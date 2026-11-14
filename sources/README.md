# sources/

Folium 2.0 的内置音源模组（方案 `dev/folium/folium-2-plan.md` §6）。每个子目录是一家平台，目录名就是它的短音源 id
（`providerRegistry.ts` 登记的 id，如 `bodian`、`appleMusic`）。九家在 S5 逐家从 `src/services/onlineMusic/<id>/` 和
`electron/<id>/` 迁过来，迁之前这里只有这份说明和 `tsconfig.json`。

- 布局、构建和依赖的声明：`dev/sources/README.md`（`npm run sources:build` 构建到 `dist-mods/`）。
- 只用公开接口：不 import `src/`、`electron/`（Dedicatus D130），只对着 `mods/folium.d.ts`（`@folia/folium`）和
  `packages/folium-source-kit`（`@folia/folium-source-kit`）编译（这里的 `tsconfig.json`，`npm run typecheck` 跑它）。
  宿主只有 `src/services/onlineMusic/web/*` 可以 import `sources/*/core`（D131）。
- 清单要过内置清单校验（`dev/sources/manifestCheck.mjs`，`test/unit/sources/builtinManifests.test.ts`）：模组 id 在受信表
  `electron/modSystem/builtinSources.cjs` 里，目录名是那一行的短 id，四种语言的名字齐全，`zh-TW.json` 不手写，不带签名文件。
- 单测里由 `test/unit/helpers/builtinSources.ts`（vitest 的 setupFiles）注册：有 `core/index.ts` 的 `createSource` 就用测试 env
  调它，否则调 `client/index.ts` 的 `activate`；到 main 入口的调用由测试用 `setBuiltinSourceRpc` 接住。
- 测试仍放 `test/unit/`。
