# ts-code-map

把 TypeScript 的编译器能力包成 MCP 工具，替代 agent 在搜索阶段的全库 grep 和大文件通读。

答案由编译器给出，因此**永远和代码同步**——这正是它要取代手维护路径表的原因。

## 零新依赖

用的是仓库里已经装着的 `typescript@7`。TS 7 的原生 Go 二进制自带 LSP 模式：

```
node_modules/@typescript/typescript-<platform>-<arch>/lib/tsc --lsp -stdio
```

不需要 `npm install` 任何东西。

## 工具

| Tool | 用途 |
| --- | --- |
| `search` | 不确定要找什么时的默认入口：符号 → 文件名 → 全文，逐层降级。支持自然语言多词查询。 |
| `find_symbol` | 按名称/模糊名称全库找符号，返回 `path:line`。代替 grep。 |
| `file_outline` | 列出文件的符号结构（带行号）。代替通读大文件。 |
| `inspect_symbol` | 看签名、类型、JSDoc、行范围、成员；`body=true` 才给源码。 |
| `references` | 一个符号的**完整影响面**：语义引用（按 write/read/type/test 分组）+ 同名的其他声明 + 仅文本命中的文件。文件列表不截断。 |
| `callers` | 谁调用了这个函数，可按 `depth` 顺调用链往上追。 |
| `callees` | 这个函数调用了谁，同样支持 `depth`。 |
| `dependency_graph` | 文件或目录的正向/反向模块依赖。纯 `import type` 标「仅类型」，`import.meta.glob` 自动注册的边会展开并标出来。 |
| `impact` | 改一个符号或文件的 blast radius，按目录分桶。 |
| `change_context` | 当前 git 改动碰到了哪些符号，各自被谁引用。给 review 用。 |

## 实测收益

在 `src/components/visualizer/fume/VisualizerFume.tsx`（3080 行）上：

| 方式 | 字节数 |
| --- | --- |
| 直接 Read 整个文件 | 124,982 |
| 原始 LSP documentSymbol JSON | 244,056 |
| `file_outline` | **3,377** |

比读文件省 **37×**；原始 LSP JSON 比源码还大，所以压缩渲染层（`format.mjs`）才是这个 server 的价值本体。

`callers buildHomeModel depth=3` 直接给出完整调用链，这是路径表永远给不出的答案：

```
buildHomeModel  src/components/app/home/buildHomeModel.ts:64
  useHomeModel  src/components/app/home/useHomeModel.ts:12
    App  src/App.tsx:142
      renderApp  src/bootstrap.tsx:53
```

响应时间：`find_symbol` 首次 ~250ms（含 project 加载），之后全部工具在 4–72ms。
模块图每次重建耗时 ~59ms（1298 个文件、3729 条边）。
十个工具的 schema 常驻上下文约 5.5KB。

## 自检与排障

```bash
node dev/mcp/ts-code-map/smoke.mjs   # 跑全部工具，逐个报耗时和输出体积
node dev/mcp/ts-code-map/cli.mjs doctor   # 环境检查：tsgo / git / rg 是否可用
```

工具行为异常时**先跑 `doctor`**，它会直接告诉你是环境问题还是代码问题。

跑一遍协议握手和四个工具，打印每个工具的耗时和输出体积。预期结果：
`find_symbol buildHomeModel` → `src/components/app/home/buildHomeModel.ts:64`；
`references buildHomeModel` → 3 处引用，1 read + 2 test。

## 实现上踩过的坑

写在这里，免得改的时候再踩一遍：

1. **服务端会反过来请求客户端。** `initialized` 之后 tsgo 会发 `workspace/configuration` 和
   `client/registerCapability` 请求。不应答的话它一直等，之后所有请求永久挂起。见
   `lsp/client.mjs` 的 `#dispatch`。
2. **`workspace/symbol` 在没有任何 `didOpen` 之前恒返回 `[]`。** 必须先推一个种子文件把
   project 拉起来（用 `src/types.ts`，不用 `App.tsx`，后者会把 227ms 的全量加载压在第一次调用上）。
3. **`start()` 和 `ensureOpen()` 会自锁。** `#boot` 推种子文件时不能走 `ensureOpen`——那个会
   `await start()`，而当时正在 `start()` 里。所以有一个不 await 的 `#syncDoc`。
4. **`documentSymbol` 把 import 说明符当成 Variable 符号返回。** `import React` 里的 `React`
   会以 kind=13 出现在第 0 行。`resolve.mjs` 的 `importLineSet` 负责滤掉，支持跨行 import。
5. **SymbolKind 对 TS 写法很粗糙。** `const f = () => {}` 报成 var，类型别名报成 class。
   `format.mjs` 的 `refineKind` 读声明行来纠正。
6. **函数的 `children` 是解构出来的参数，不是成员。** `buildHomeModel` 会因此多列 36 行噪声。
   只有 class/interface/enum 这类容器才展开 children。
7. **tsgo 捕获 SIGTERM，光 `child.kill()` 杀不掉它。** 它在等 LSP 的 `exit` 通知，只发 SIGTERM
   会留下 ~19MB 的孤儿进程。`dispose()` 先按协议发 `exit` 再 SIGKILL 兜底，并且 SIGTERM /
   SIGINT / SIGHUP / stdin 关闭 / `process.exit` 五条退出路径全都挂了 handler。
   回归验证：`node dev/mcp/ts-code-map/smoke.mjs` 跑完后 `pgrep -f "lib/ts[c] --lsp"` 应为空。

## 已知限制

- `impact` 和 `change_context` 给的是**传递闭包上界**，会高估影响面。输出里会标明 depth 和
  截断情况，别当成精确答案。
- 模块图只收 git 跟踪的源文件。`.svg` / `.png` / `.json` 这类资源 import 不进图（实测仓库里
  有 8 个这样的 import，都是资源，不是解析失败）。

- `callees` 默认略过 `node_modules/` 和 `.d.ts` 里的条目（否则 `Array.filter`、`Array.find`
  这类会淹掉真正的项目内调用），略过数量会在输出末尾说明。
- call hierarchy 里模块顶层的调用，LSP 给的 name 是文件绝对路径，显示成 `<模块顶层> 文件名`。

- `references` 的 write/read 判定来自 LSP 的 `documentHighlight`，准确；但 **type 判定是行级正则
  启发式**，只认无歧义的标记（`<`、`extends`、`as` 等）。`foo: Bar` 的冒号和对象字面量
  `{ key: value }` 靠正则分不开，所以宁可漏判（落进 read）也不误判。
- 引用文件超过 25 个时，靠后文件不做 write 判定，会被归入 read。输出里会明确提示。
- 只覆盖 TS/TSX/JS（`allowJs: true`，所以 `electron/*.cjs` 也在内）。`.md`、`.json`、
  shader 字符串查不到，那些仍然要用 rg。

## 文件同步

工具访问文件前会比对 mtime，变了就整篇重推给 tsgo。所以 agent 边查边改不会拿到过期结果。
同时打开的文档超过 40 个时按 LRU 关闭最旧的。

## 依赖图的两个校正

写的时候踩到、值得记下来：

1. **`import type` 必须和值导入分开。** 全仓 3729 条边里有 891 条（24%）是纯类型边，它们在
   运行时根本不存在。不区分的话，「谁依赖这个模块」会被严重高估——例如 `src/stores` 看起来
   import 了 `src/components/UnifiedPanel.tsx`（像是违反分层），实际只是 `import type { PanelTab }`。
2. **别写死剥 `b/` 前缀。** 这个仓库开了 `diff.mnemonicPrefix`，`git diff` 的前缀是 `w/` 而不是
   `b/`，写死会得到错的路径。统一加 `--no-prefix`。


## 环境依赖（都是可选的）

只有 tsgo 是硬依赖，其余缺了会降级而不是失效：

| 缺什么 | 后果 |
| --- | --- |
| tsgo 二进制 | 所有工具不可用，先 `npm install` |
| `git` | `change_context` 不可用；其余工具自动改为扫文件系统（会多收一些未跟踪文件） |
| `rg` | `search` 的全文兜底改用纯 JS 扫描，只是慢一些 |

受限沙箱里 `spawn git` 会 EPERM，早期版本因此让 `impact` 和 `dependency_graph` 整个失效；
现在这条路已经打通。

## 这个工具不擅长什么

说清楚边界，免得在它给不出答案的地方硬耗：

**语义引用会被对象展开和别名切断。** `...typography` 之后的属性传播、局部别名重命名，LSP 结构上
追不动。这不是精度问题而是天花板：实测 `lyricsFontScale` 这个功能面共 46 个文件，纯语义方法
（引用 + 同名声明）最多只能到 27 个，**59% 就是上限**。所以 `references` 现在把文本层一起报出来，
单独分组标注「需人工确认」，召回补到 100%。语义部分精确，文本部分需要你自己过一眼。

**动态注册只能部分还原。** `import.meta.glob` 已经在依赖图里展开了，但运行时按字符串拼出来的
注册关系仍然需要架构知识补充——这正是 `skills/codebase-navigation` 还要存在的原因。

**结论**：它的强项是**精确性 + 消歧**（能区分同名但无关的声明，不会命中字符串和注释），
以及不读大文件就看清结构。功能面的完整性靠内置的文本层补齐，不需要你再单独跑一次 rg。


## 性能：瓶颈是往返次数，不是服务端

实测（本机，混合真实用法的调用序列）：

| | 结果 |
| --- | --- |
| 63 次混合调用的服务端总耗时 | **1.9 秒**（平均 30ms/次） |
| 同样 63 个问题按每批 6 个打包 | 11 次往返，服务端 1.8 秒 |

服务端计算基本不花时间。真正贵的是**每次工具调用的 agent 往返开销**，比服务端计算高约两个
数量级。所以：

**一条 shell 命令可以用管道和 `&&` 塞进三四个动作，MCP 工具默认一次只答一个问题。**
这是 MCP 相对 rg/find 唯一真实的结构性劣势，`batch` 就是用来补它的。

已经知道接下来要问哪几个问题时，用一次 `batch` 问完，不要连发五次单独调用。上面的例子里
往返次数从 63 降到 11，减少 5.7 倍，而服务端耗时没变。


## references 的召回率

以「歌词字号 `lyricsFontScale` 这个功能要改哪些文件」为基准（rg 全仓搜同名得到 46 个文件）：

| 版本 | 召回 |
| --- | --- |
| 只报语义引用 | 9/46 = **20%** |
| 语义引用 + 同名声明（不截断） | 27/46 = **59%**（纯语义方法的天花板） |
| 再加文本层（当前） | **46/46 = 100%** |

一次调用 307ms，输出 2919 字节，相对 rg 基准零误报。

早期版本 20% 里有一半是自伤：同名声明列表被硬编码 `slice(0, 8)` 截掉，而且 `limit` 参数管不到它。
**路径很便宜，源码行才贵**——所以现在截断只作用于每组的代码行细节，文件列表一律给全。
