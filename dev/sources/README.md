# 音源模组的构建（`dev/sources/`）

把仓库里的音源模组（`sources/<id>/`）构建成能加载的模组目录（`dist-mods/<id>/`）。Folium 2.0 方案
`dev/folium/folium-2-plan.md` §6.2。

| 文件 | 做什么 |
| --- | --- |
| `build.mjs` | 入口：选哪些音源、写产物、指纹、watch、`foliaBundledSources` |
| `bundle.mjs` | rolldown 打包与依赖规则（每个 import 在这里按声明放行或报错） |
| `dependencies.mjs` | 读依赖声明、找包、算 `deps` 归档的闭包与指纹、打归档 |
| `locales.mjs` | 由 `zh-CN.json` 生成 `zh-TW.json`（和宿主同一条转换） |
| `manifestCheck.mjs` | `sources/*/` 的内置清单校验（测试在 `test/unit/sources/builtinManifests.test.ts`） |
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
- `--stamp <package.json>`：把这次带的音源写进那份 package.json 的 `foliaBundledSources`（和 CI 写 `foliaReleaseChannel` 一样，
  打包前写）。**九家迁完、S8 做打包形态之前不要用**：九家还是宿主静态注册的时候，写出一个不全的列表等于声明这个安装包不带它们，
  会放开外部模组对它们的接管（方案 §5.1）。构建脚本挡着：声明里少了九家中任何一家，`--stamp` 报错、不写文件（`stampRefusal`），
  S8 做打包形态时去掉。
- 环境变量 `FOLIA_BUNDLED_SOURCES`：没设是 `sources/` 里的全部；设成空是一个都不带；否则是逗号隔开的目录名（就是短音源 id），
  拼错的报错。`foliaBundledSources` 是这些目录里的模组在受信表（`electron/modSystem/builtinSources.cjs`）里那一行的短 id。

开发版的内置目录就是 `dist-mods/`（`electron/modSystem/discovery.cjs` 的 `getBuiltinModsDirectory`：开发版是
`<appPath>/dist-mods`，打包版是 `resources/builtin-mods`）；打包时 `package.json` 的 `extraResources` 把 `dist-mods/` 放到
`resources/builtin-mods/`。`npm run build:electron*`、`dev:electron:dist*` 和发布用的 workflow 都先跑一遍构建。

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
package.json 里声明了的包、main 与 worker 里的 Node 内置模块。`electron`、宿主（`src/`、`electron/`、`@/` 别名）、
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
| `native` | 原生件（`.node`、伴侣程序） | 不打包、不进归档；源码 import 它是构建错误，经 `api.native.load(name)` / `api.native.path(name)` 引用（清单 `native` 与受信表那一行的 `native`） |

`deps` 归档的文件名带内容指纹：Electron 按路径把 `.asar` 的文件表缓存到进程结束，原地换内容会读到旧的表（方案 §13）。
归档里有 `.node` 文件时构建报错（asar 里加载不了原生件，把那个包声明成 `native`）。watch 时闭包的结构（每个包的位置、版本）
没变就不重算指纹、不重打归档；内容变了但版本没变（手改 `node_modules`）要重启 watch 或者跑一次全量构建。

## 测试

- `test/unit/sources/buildSources.test.ts`：用构建夹具走每条路径，跑起构建出的 main 入口（Node 里把归档解成同名目录；
  装着 Electron 时用它的 Node 模式 `ELECTRON_RUN_AS_NODE=1` 直接读 `.asar`），每种写错了会报的错。
- `test/unit/mod-system/builtinBuildWatch.test.ts`：产物在主进程的加载器里以 `builtin` 层级加载、rpc 走通；改 `build.json` 只重载那一个。
- 构建夹具：`test/fixtures/folium-sources/fixture-source/`（client、core、main、worker、语言表、四种依赖各一个本地包）。
