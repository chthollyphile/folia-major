# 音源模组的构建（`dev/sources/`）

把仓库里的音源模组（`sources/<id>/`）构建成能加载的模组目录（`dist-mods/<id>/`）。Folium 2.0 方案
`dev/folium/folium-2-plan.md` §6.2。音源模组本身怎么写见 `docs/folium/sources.md`，往仓库里加一家见
`src/services/onlineMusic/README.md` 的「接入一个新平台」。

| 文件 | 做什么 |
| --- | --- |
| `build.mjs` | 入口：选哪些音源、写产物、指纹、watch、`foliaBundledSources` |
| `bundle.mjs` | rolldown 打包与依赖规则（每个 import 在这里按声明放行或报错） |
| `dependencies.mjs` | 读依赖声明、找包、算 `deps` 归档的闭包与指纹、打归档 |
| `locales.mjs` | 由 `zh-CN.json` 生成 `zh-TW.json`（和宿主同一条转换） |
| `manifestCheck.mjs` | `sources/*/` 的内置清单校验（测试在 `test/unit/sources/builtinManifests.test.ts`） |
| `pack.mjs` | `npm run sources:pack`：把 `dist-mods/<id>/` 打成能「从 zip 安装」的包，可签名（见下面「打成 zip」） |
| `typecheck.mjs` | `npm run typecheck` 的后半段：kit、`sources/`、构建夹具各按自己的 tsconfig 编译 |

## 用法

```bash
npm run sources:build
```

```bash
npm run sources:build -- --watch
```

```bash
npm run sources:build -- --extra test/fixtures/folium-sources/fixture-source
```

- 不带参数：构建 `sources/` 下全部音源，产物目录 `dist-mods/` 和这次的选择一致（这次没构建、却是本脚本产出过的模组目录会被删掉；
  只认带 `build.json` 的目录，别的不碰）。
- `--watch`：先全量构建，再盯着 `sources/`、`--extra` 的目录和 `packages/folium-source-kit/src/`；改了哪个音源目录里的文件只重建它，
  改了 kit 重建全部。构建出错只打出来，接着盯。`npm run dev:electron` 同时以这个方式跑它。
- `--extra <目录>`：另外构建一个不在 `sources/` 里的音源目录（可以写多次），比如构建夹具。
- `--root <目录>`、`--out <目录>`：换掉 `sources/` 和 `dist-mods/`（测试用）。
- `--stamp <package.json>`：把这次带的音源写进那份 package.json 的 `foliaBundledSources`。打包不需要它：electron-builder 的上层配置
  `build/bundledSources.mjs` 经 `extraMetadata` 把同样的列表写进安装包里的 package.json，仓库里的 package.json 不动。留给手工装配
  的场合（例如直接拿 `dist-mods/` 拼一个包）。
- 环境变量 `FOLIA_BUNDLED_SOURCES`：没设是 `sources/` 里的全部；设成空是一个都不带；否则是逗号隔开的目录名（就是短音源 id），
  拼错的报错。`foliaBundledSources` 是这些目录里的模组在受信表（`electron/modSystem/builtinSources.cjs`）里那一行的短 id。

开发版的内置目录就是 `dist-mods/`（`electron/modSystem/discovery.cjs` 的 `getBuiltinModsDirectory`：开发版是
`<appPath>/dist-mods`，打包版是 `resources/builtin-mods`）。`npm run build:electron*`、`dev:electron:dist*` 和发布用的 workflow
都先跑一遍构建。

### 安装包与网页版带哪些音源

`package.json` 的 `build.extends` 指向 `build/bundledSources.mjs`，electron-builder 先读它，再合上 `package.json` 的 `build`。
它按 `FOLIA_BUNDLED_SOURCES`（`dev/sources/selection.mjs`，规则同上）决定：

- `extraResources`：只把带的 `dist-mods/<id>` 放到 `resources/builtin-mods/<id>`；`dist-mods/` 和选择对不上（多了或少了）时拒绝
  打包，所以 `sources:build` 要用同一个 `FOLIA_BUNDLED_SOURCES` 先跑；用 `--extra` 构建过夹具的，先不带 `--extra` 重跑一次。
- `extraMetadata.foliaBundledSources`：写进安装包里的 package.json，主进程据此认出「不带」的音源，放开外部模组对它的接管（方案 §5.1）。
- `files` 的排除规则（`dev/sources/packaging.mjs`）：各音源声明的上游库连同只有它们用到的依赖都不进 app.asar（根 `dependencies`
  仍保留，`sources:build` 和 Vercel / Cloudflare 的入口要用）；宿主自己 require 的包与带上的音源的原生件留着；不带的音源的原生件不进。
- Apple Music 的伴侣程序（win / mac 的 `extraResources`、`beforePack` 的编译、`afterPack` 的核对）只在带 Apple Music 时有。
- 受信表 `electron/modSystem/builtinSources.cjs` 九行都留着：外部模组接管一个不带的音源时，它声明的旧登录要拿那一行核对
  （`sourceOwnership.cjs` 的 `claimRefusal`）。这和方案 §6.2「受信表带哪几行」的字面不同。
- 方案 §11「安装包里搜不到任何平台的代码和名字」现在做不到「名字」：不带的音源的代码与上游库都不进包，但宿主里还留着它的
  id 与名字——受信表、注册表顺序 `BUILT_IN_SOURCE_ORDER`、`nativeFiles.cjs` 的原生件名、旧键迁移表、语言包的版本说明、渲染端的
  平台 id 字符串。要做到得把这些也按选择生成，待维护者定。
- 开发版用子集（`FOLIA_BUNDLED_SOURCES=… npm run dev:electron:dist*`）时仓库的 package.json 没有 `foliaBundledSources`，主进程按
  九家都带处理，没构建的那几家会被判成安装损坏；要试子集，用 `--stamp` 写一份临时的 package.json 副本。

网页版（`npm run build`）经虚拟模块 `virtual:folia-web-sources` 只 import 选中的 `src/services/onlineMusic/web/<id>.ts`，没带的那一家
连 core 都不进包。

## 打成 zip（`sources:pack`）

方案 §5.1 的合规预案：安装包不带某个内置音源时（`FOLIA_BUNDLED_SOURCES`），同一份宿主装上外部的音源模组就能接着用。
`npm run sources:pack` 把构建好的 `dist-mods/<id>/` 打成这样一个包，用模组面板的「从 zip 安装」装（要开着模组系统）。

```bash
npm run sources:pack
```

```bash
npm run sources:pack -- bodian
```

```bash
npm run sources:pack -- --all
```

- 不带参数：列出 `dist-mods/` 里能打的（有 `mod.json` 和 `build.json` 的目录）、大小、带不带 deps 归档和原生件。先跑 `sources:build`。
- `<id>`：目录名（短音源 id，如 `appleMusic`）或模组 id（`apple-music`），可以写几个；`--all` 打全部。
- 产物：`dist-mod-packs/<模组 id>-<版本>.zip`，未签名的是 `…-unsigned.zip`（git 忽略），如 `bodian-1.0.0-unsigned.zip`；
  带上了原生件的按系统出，名字多一段系统（这个系统一个都没带时不加）：`spotify-1.0.0-win32-x64-unsigned.zip`。同一份构建打两次未签名的包，字节相同。
- `--system <platform>-<arch>`：原生件按哪个系统带（`win32-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`），默认本机。
  可以在一台机器上给别的系统打包（librespot 的 npm 包里四个系统的 `.node` 都有）。
- `--no-native`：不带原生件（包名不带系统段），接管后靠原生件的功能用不了。
- `--version <x.y.z>`：换掉包里的版本号（覆盖内置副本要比安装包里那份高；内置的清单都是 `1.0.0`）。
- `--folia <范围>`：包里写的宿主范围，默认 `>=<仓库 package.json 的版本>`（预发布号去掉），`none` 是不写。默认值只是占位：
  比它旧的宿主本来就不收 Folium 2 模组，它不额外挡什么；上限和真正的下限等维护者定。
- `--dist <目录>`、`--out <目录>`：换掉 `dist-mods/` 和 `dist-mod-packs/`。

**包里是什么**：一个 `<模组 id>/` 目录，构建产物原样（`client.mjs`、`index.cjs`、worker、`vendor.<指纹>.mjs`、`deps.<指纹>.asar`、
语言表、`README.md`），不带 `build.json`（只给开发版的主进程盯着重载），加上这个系统的原生件（见下）。`mod.json` 比构建出的多两样：

- `sources[].claims`：受信表（`electron/modSystem/builtinSources.cjs`）里这个模组那一行的短 id、旧 electron-store 键、会话分区、
  userData 目录、媒体缓存目录下的旧缓存目录（`legacyCacheDirs`，现在只有 spotify），照抄（宿主核对 claims 不能超出那一行）。
  不在受信表里的模组没有 claims，装上是第三方音源 `folium.<模组 id>.<名字>`。
- `folia`：上面的宿主范围。

**原生件**：安装包不带某家音源时也不带它的原生件，接管它的副本用包里自己的那份。布局（宿主按这个找，
`electron/modSystem/nativeFiles.cjs` 的 `MOD_NATIVE_ENTRIES`）：

```text
<模组 id>/native/<名字>/<platform>-<arch>/<入口>
```

| 名字 | 系统 | 入口（`api.native.path` 答的） | 一起带的 | 大小（`.node` / 整包 zip） |
| --- | --- | --- | --- | --- |
| `librespot` | win32-x64、darwin-arm64、linux-x64、linux-arm64（glibc） | `dist/index.js`（包自己的加载器） | `package.json`、`dist/types.js`、`prebuilds/<系统>/librespot_addon.node` | 13.7 / 5.3 MB、11.8 / 5.0、18.3 / 6.6、12.6 / 5.3 |
| `apple-music-companion` | win32-x64 | `FoliaAppleMusicCompanion.exe` | `.exe.config`、两个 WebView2 托管 DLL、`WebView2Loader.dll`（和安装包里同一组） | 0.9 / 0.3 MB |

- 只带清单 `native` 与受信表那一行 `native` 都写了的名字；接管副本也只能解析这些（`native-not-granted` 以外的名字）。
- librespot 从装着的 `@lox-audioserver/node-librespot` 取；Apple Music 伴侣程序从 `build/apple-music-native/windows` 取，没有时
  报错并给出构建命令（`powershell -NoProfile -ExecutionPolicy Bypass -File sources/appleMusic/native/windows/buildCompanion.ps1`，要 .NET SDK）。
- **macOS 的伴侣程序不带**：它是签名的 `.app`，经 zip 解到用户目录后签名和可执行位保不保得住没验证；`--system darwin-*` 打 appleMusic
  时会写明不带，接管后每个请求答 `runtime-unavailable`。Linux 没有伴侣程序；darwin-x64 与 musl 的 Linux 没有 librespot 现成构建。
- 可执行位：`zipInstall.cjs` 解包只写文件内容，不保留权限位。现在带的都用不到：Windows 不看可执行位，`.node` 是 `dlopen`
  读进来的（Linux、macOS 只要可读）。将来要带 macOS / Linux 的可执行程序时得先补这一步。
- 内置副本、官方签名的覆盖副本仍用应用带的那份；包里的 `native/` 只给接管用。原生件和别的文件一样算进内容摘要与签名摘要，
  换了就要重新确认。系统目录 `native/<名字>/<系统>/` 里有任何符号链接或 junction，宿主都不解析（`native-unsafe-path`）。
- 应用开着时从 zip 装新版接管副本，新的 `.node` 要重启应用才生效：同一路径的原生模块已经载入进程，再 require 拿到的还是旧的
  （Windows 上旧目录也删不掉，留在 `mods/.staging` 里，下次启动清掉）。
- `claims.legacyCacheDirs` 是补项 C（`40e0a1641`）加的。那之前的宿主（包括那之前出的滚动版）校验清单时遇到 `claims` 里不认识的字段
  会整包拒绝，装不上 spotify 的包；要给它们打包时手动去掉这一项。之后的宿主改成忽略 `claims` 里不认识的字段（不认领任何东西），
  以后再加字段，新包在这些宿主上也装得上。

打之前按「从 zip 安装」（`zipInstall.cjs`）和摘要（`modDigest.cjs`）的上限查：单个文件 64 MB、合计 96 MB、2000 个文件，
zip 本身 96 MB；`dist-mods/<id>/` 的文件和 `build.json` 记的对不上（手改过、没构建完）时拒绝并列出多出与缺的文件，重新构建再打；
重新构建删不掉旧文件时多半是开着的应用占着，先关应用。签名时 `folium.sig.json` 也算进 2000 个文件。

**签名**：给了私钥就在包里的目录写 `folium.sig.json`，格式和算法就是宿主验的那一套（`electron/modSystem/modSignature.cjs`：签名摘要
v1、固定格式的签名消息、Ed25519），签完先用宿主的验签在临时目录里验一遍。按宿主的验签实现写，没和 folium-compound 的
`tools/sign.mjs` 逐字节对照过。

- 私钥：`--key <文件>`，或环境变量 `FOLIUM_SIGNING_KEY`（私钥文字）、`FOLIUM_SIGNING_KEY_FILE`（文件）；PEM（PKCS#8）或 JWK。
- keyId：`--key-id`、`FOLIUM_SIGNING_KEY_ID`，JWK 里有 `kid` 时也认。必须是受信公钥表（`trustedKeys.cjs`）里的一把、没吊销、
  和私钥是一对，否则报错（签出来宿主只会标「签名不匹配」）。
- 没给私钥：出未签名的包，并打一行说明。未签名的包只能在安装包**不带**这个音源时经确认接管；安装包带着时它不覆盖内置副本
  （覆盖要 `verified`、版本更高、`folia` 范围满足、确认过一次，方案 §5.1）。先行测试钥匙签的（`beta`）同样只能接管。
- 仓库里没有私钥。官方签名由维护者在本机或 folium-compound 的 CI 里给私钥跑同一条命令。

**装上之后能不能跑**（接管 = 安装包不带这个音源；覆盖 = 安装包带着，官方签名、版本更高的副本替代内置副本）：

| 音源 | 包里带的 | 接管时 | 覆盖时 |
| --- | --- | --- | --- |
| bodian、qishui、fnmusic | 入口（上游库打进 `index.cjs`） | 能跑；fnmusic 存下的 `folia-fnmusic://` 旧地址回 404（旧协议只交给内置副本） | 能跑 |
| ytm | 入口 + `vendor.<指纹>.mjs` | 能跑 | 能跑 |
| netease、kugou、qq | 入口 + `deps.<指纹>.asar`（netease 约 49 MB，zip 约 21 MB；kugou、qq 各十几 MB） | 能跑：归档随包装进 `userData/mods/<id>/`，入口照旧用 `createRequire` 从归档里取上游库 | 能跑 |
| spotify | 入口（`ws` 打进去）+ 本系统的 librespot | 能跑：librespot 用包里那份，旧缓存目录 `spotify` 经 claims 认领；darwin-x64、musl 上没有 librespot，整首播放不能用 | 能跑：拿应用带的那份 |
| appleMusic | 入口 + Windows 上的伴侣程序 | Windows 能跑（伴侣程序用包里那份）；macOS 包里不带伴侣程序，每个请求都答 `runtime-unavailable`；Linux 本来就没有 | 能跑：拿应用带的那份（只有 macOS、Windows） |

一个包从打出来到装上的桌面实测做法（开发版）：

1. `FOLIA_BUNDLED_SOURCES=<除了它的那几家> npm run sources:build -- --stamp package.json`（先备份 `package.json`），让开发版
   当成「不带它」的安装。
2. `npm run sources:pack -- <它>`（`dist-mods/` 里已经没有它时，先用全带的构建打好包，再做第 1 步）。
3. 启动应用（模组系统开着），「从 zip 安装」装 `dist-mod-packs/<它>-1.0.0-unsigned.zip`，启用时确认窗口列出它要接管的短 id 和旧数据；确认后它以
   短 id 出现。
4. 还原 `package.json`，不带变量重跑 `npm run sources:build`。外部副本在全带的安装里不再加载（未签名，不覆盖），可以在模组面板删掉。

测试：`test/unit/sources/packSources.test.ts`（打包、用宿主的 `installModFromZip` 装进临时目录、claims 过受信表核对、接管与
不覆盖、签名后 `verified`、改一个字节 `digest-mismatch`、上限与私钥的报错）。

## 一个音源目录

```text
sources/<id>/
  mod.json        清单（folium 2、sources、client: "client.mjs"、main: "index.cjs"、locales、assets）
  package.json    依赖与它们的做法、worker 入口
  README.md       原 UPSTREAMS.md 里这一家的内容；原样带进产物
  core/index.ts   createSource(env)（只有网易云、酷狗、QQ 有）
  client/index.ts activate(folium)            → client.mjs（ESM，一个文件）
  main/index.ts   activate(api)               → index.cjs（CommonJS，只导出 default）
  main/<x>.ts     package.json 的 folia.workers → <name>.cjs
  locales/        zh-CN、en、in、vi 四份；zh-TW.json 由构建生成，不手写
  assets/         原样带上
```

每个产物目录最后写 `build.json`（产物的指纹与文件表）。开发版的主进程盯着它（`electron/modSystem/builtinBuildWatch.cjs`）：
指纹变了，模组的版本记号跟着变，差量重载只重启这一个模组，client 的地址也换了，窗口重新载入它。

源码只能 import：自己目录里的文件、`@folia/folium-source-kit`、`@folia/folium`（只有类型，写成 `import type`）、
package.json 里声明了的包、main 与 worker 里的 Node 内置模块，和有 deps 归档的音源的 main 与 worker 里的 `@folia/source-deps`（见下）。`electron`、宿主（`src/`、`electron/`、`@/` 别名）、
没声明的包都是构建错误；client 里还不能有 Node 内置模块和宿主注入的库（react、react-dom、i18next、react-i18next、zustand）。

## 依赖怎么声明

```json
{
  "dependencies": { "<包>": "<钉死的版本>" },
  "folia": {
    "dependencies": { "<包>": "asar" },
    "workers": { "worker": "main/worker.ts" }
  }
}
```

版本照 `src/services/onlineMusic/UPSTREAMS.md` 的规矩钉死（构建核对装着的版本，不一致就报错，先 `npm install`）；
`file:<路径>` 指本地目录（构建夹具用）。包从音源目录往上按 Node 的规矩找，也就是仓库根的 `node_modules`
（根 `dependencies` 留着这些包，Vercel、Cloudflare、Docker 也在用）。

| 做法 | 什么时候用 | 产物 |
| --- | --- | --- |
| `bundle`（不写就是它） | 普通的包 | 打进用到它的入口（`index.cjs`、`<worker>.cjs` 或 `client.mjs`） |
| `asar` | 依赖真实文件布局的上游库（改 `require.cache`、扫 `module/` 目录、按包内路径挂钩子），只给 main 与 worker | 生产依赖闭包（`dependencies`、装着的 `optionalDependencies` 与 `peerDependencies`）装进 `deps.<指纹>.asar`；入口里是 `createRequire(join(__dirname, 'deps.<指纹>.asar', 'node_modules', '_'))('<包>')` |
| `vendor` | ESM-only 的包，只给 main 与 worker | 用到的这类包一起打成 `vendor.<指纹>.mjs`，入口 `require('./vendor.<指纹>.mjs')`（Node 的 require(esm)：vendor 里不能有顶层 await；文件名带指纹，因为 require(esm) 载入的模块在 Node 的 ESM 缓存里，清 `require.cache` 清不掉，原地覆盖的文件重载后还是旧的） |
| `native` | 原生件（`.node`、伴侣程序） | 不打包、不进归档；源码 import 它是构建错误，经 `api.native.load(name)` / `api.native.path(name)` 引用（清单 `native` 与受信表那一行的 `native`）；内置副本拿应用带的，接管副本拿 `sources:pack` 放进包里 `native/` 的（见「打成 zip」） |

上游要按包内路径动手脚（换 `require.cache` 的某一项、先放替身再加载，网易云的 worker 就是这样）时，字面写的 import 拿不到
文件在归档里的路径：main 与 worker 可以 `import { depsRequire } from '@folia/source-deps'`，它是绑在本模组归档上的
`createRequire`，`depsRequire.resolve('<包>/<文件>')` 是那个文件在归档里的路径，`depsRequire('<包>/<文件>')` 按需加载。
client 里、没有 asar 依赖的音源里 import 它是构建错误；类型在 `dev/sources/sourceDeps.d.ts`。

`buildSource` 交回的 `archive` 是 deps 归档的规模和这次的耗时（名字、字节数、包数、文件数、这次有没有真打、算闭包与指纹的毫秒数、
打包的毫秒数），打了新归档时也打一行日志。

`deps` 归档的文件名带内容指纹：Electron 按路径把 `.asar` 的文件表缓存到进程结束，原地换内容会读到旧的表（方案 §13）。
归档里有 `.node` 文件时构建报错（asar 里加载不了原生件，把那个包声明成 `native`）。watch 时闭包的结构（每个包的位置、版本）
没变就不重算指纹、不重打归档；内容变了但版本没变（手改 `node_modules`）要重启 watch 或者跑一次全量构建。

## 测试

- `test/unit/sources/buildSources.test.ts`：用构建夹具走每条路径，跑起构建出的 main 入口（Node 里把归档解成同名目录；
  装着 Electron 时用它的 Node 模式 `ELECTRON_RUN_AS_NODE=1` 直接读 `.asar`），每种写错了会报的错。
- `test/unit/mod-system/builtinBuildWatch.test.ts`：产物在主进程的加载器里以 `builtin` 层级加载、rpc 走通；改 `build.json` 只重载那一个。
- 构建夹具：`test/fixtures/folium-sources/fixture-source/`（client、core、main、worker、语言表、四种依赖各一个本地包）。

## 三个真实上游库的依赖归档样例

方案 §10「剩余阶段的顺序」第 2 步：`test/fixtures/folium-sources/deps-archive/` 下的网易云、酷狗、QQ 三个样例，各把上游库
声明成 `asar`，main 入口（网易云在 worker 里）从归档加载它、照宿主现在的做法起后端、发一个不需要登录的请求。只是样例：
不注册音源。三家后来迁成音源模组时照这个做法把上游库声明成 `asar`（`sources/netease/`、`sources/kugou/`、`sources/qq/`）；
样例留着，给冒烟脚本和 CI 用。

```bash
node test/manual/folium2DepsArchiveSmoke.mjs
```

脚本构建三个样例，复制一份 Electron 摆出安装版的布局（冒烟的主进程在 `resources/app.asar`，样例在
`resources/builtin-mods/`），启动它，打印每家「加载 / 后端起来 / 请求」的结果和耗时，再把模组目录的大小和覆盖包的上限对一下。
请求失败分成网络和别的原因；默认只有加载或后端失败才算失败，`--strict-request` 时非网络的请求失败也算。CI 上由
`.github/workflows/folium2-deps-archive-smoke.yml` 在三个系统上跑。
