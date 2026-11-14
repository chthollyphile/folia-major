# folium-source-kit

Folium 2.0 音源模组共用的纯 TypeScript 函数（方案 `dev/folium/folium-2-plan.md` §6.1）。仓库里的音源模组
（`sources/<id>/`）不能 import `src/`、`electron/`，它们和宿主都要用的东西放在这里。

```ts
import { createHandedOut, errorFields, krcDecrypt, withLoginRequestLimit } from '@folia/folium-source-kit';
```

别名 `@folia/folium-source-kit` 指向 `src/index.ts`，在这几处各配一处：根 `tsconfig.json` 与 `sources/tsconfig.json` 的
`paths`、`vite.config.ts` 与 `vitest.config.ts` 的 `resolve.alias`、`dev/sources/build.mjs`、模块图
（`dev/mcp/ts-code-map/graph/modules.mjs` 的 `ALIAS`）。只从包的入口取，不深入子路径。

## 规矩

- 只放纯函数：不 import 包外的任何东西（D308，`test/unit/dedicatus/contracts/packageIndependence.test.ts`），
  运行时零依赖；不认识任何平台。
- 类型只用 ES2022 和 DOM（`tsconfig.json` 没有 Node 的类型）：渲染进程和主进程都能跑。
- 每个音源模组把用到的部分打进自己的 bundle，**各有一份**。所以有模块级状态或者靠 `instanceof` 认的东西，
  跨模组就不是同一份了，见下面的注意。

## 清单

| 模块 | 内容 | 原来在 | 谁在用 |
| --- | --- | --- | --- |
| `errorText.ts` | `errorMessage`、`errorFields`、`codeText`：把抛出的错拆成原文的字段 | `src/utils/errorText.ts`（那里留着转出） | 网易云、酷狗、QQ、YouTube Music、Spotify 与宿主 |
| `exploreReads.ts` | 探索页反复从头读时的轮换（`createHandedOut`）与游标里的读次（`stampCursor`、`cursorWords`） | `src/services/onlineMusic/exploreReads.ts` | 网易云、QQ、汽水、YouTube Music、Spotify 的探索页 |
| `krcDecrypt.ts` | KRC 歌词解密与解压 | `src/services/onlineMusic/kugou/krcDecrypt.ts` | 酷狗的歌词、宿主的本地 KRC 文件 |
| `loginRequestLimit.ts` | 登录请求的 20 秒时限（`withLoginRequestLimit`、`LoginRequestTimeout`、`isLoginRequestTimeout`、`dropLoginRequestLimits`） | `src/services/onlineMusic/login/loginRequestLimit.ts` | 网易云、酷狗、QQ 的登录，宿主的登录失败归类与取消登录 |

## 注意

- `loginRequestLimit.ts` 有模块级的计时器表，宿主取消登录时调 `dropLoginRequestLimits()` 清它：九家还在宿主里时只有一份；
  一家迁成模组以后，它 bundle 里的那一份宿主够不着，取消登录要另想办法（例如经 `auth@1` 告诉音源），迁第一家用到它的平台
  （酷狗）时处理。超时的归类已经按名字认（`isLoginRequestTimeout`，宿主的 `loginFailureCase.ts` 用它），不靠 `instanceof`。
- 同样的道理，以后进 kit 的东西不要靠 `instanceof` 或模块级状态跨模组共享。
