# Folium 制作 MCP

给支持 MCP 的 Agent 提供官方文档、真实参考源码、静态检查和歌词设计指导。成品是标准 Folium 模组，使用现有 `mod.json`、`registries.visualizers`、安装、启用确认和生命周期；本工具不扩展播放器契约或另建加载器。

## 源码启动与客户端

安装仓库依赖，使用 Node 24.15 或更高的 24.x。stdio 直接运行 Node，不用 `npm run` 作为客户端 command，以免 npm 输出污染协议。

```sh
node dev/folium/mcp/server.mjs
npm run folium:mcp:doctor
npm run folium:mcp:config
```

配置片段生成到 `dist-folium-mcp-clients/`。路径指向当前机器；只合并 `folium-authoring` 条目，移动源码后重新生成。服务依赖仓库文档、检查器及已钉版本的 SDK，不能只复制 server.mjs。

| 客户端 | 配置 |
| --- | --- |
| Codex | `codex.stdio.toml`；或 `codex mcp add folium-authoring -- node <入口绝对路径>` |
| Claude Code | `claude-code.stdio.json` 合入项目 `.mcp.json`；或 `claude mcp add --transport stdio --scope local folium-authoring -- node <入口绝对路径>` |
| Claude Desktop | `claude-desktop.stdio.json` 合入桌面端配置；未提供云端连接器 |
| DeepSeek Harness | `deepseek-harness.stdio.yaml` 插件项并入 profile，使用官方 `@deepseek-ai/dsh-mcp-client`，不是 mcpServers JSON |
| WorkBuddy | 对应 JSON 导入 MCP 自定义配置入口 |
| 其他 | `generic.stdio.json`，按宿主配置约定合并 |

不同客户端只影响配置序列化；7 个 tools、resources 和 prompt 来自同一个服务。现代客户端可协商 SDK 1.32.2 支持的协议（包括 2025-11-25），不宣称实现更新的协议特性。SDK 互通测试不等于各客户端 UI 或模型回合实测。

可选的同机 HTTP：设置随机 `FOLIUM_MCP_TOKEN`（32–256 位 URL-safe 字符），运行 `node dev/folium/mcp/server.mjs --http 43197`。服务只监听 `127.0.0.1`，检查 Bearer 和 Host，拒绝 Origin；无 SSE、公网 OAuth 或云端接入。客户端需获得同一令牌，配置中只有变量引用。诊断：`npm run folium:mcp:doctor -- --http http://127.0.0.1:43197/mcp`。

HTTP 配置分别采用 Codex 的 `bearer_token_env_var`、Claude Code 的 `type: http`、WorkBuddy 的 `type: streamableHttp`、DeepSeek Harness 的 `transport: streamable-http`；变量展开遵循各宿主约定。默认使用 stdio。

## 工具流程

1. `folium_brief({task, source?, kind?, lyricTemplate?})`：获取审美 skill、三种入场与 N+2 规则。source 为 original、wallpaper、video 或 revision。
2. `folium_read_guide({topic, startLine?, lineCount?})`：读 quickstart、contributing、api、types、specification 或审美参考；每页最多 240 行、约 48K 字符，返回 nextLine 时继续。支持只有 tools 的客户端。
3. `folium_catalog({kind?})` / `folium_reference({style, file?, startLine?, lineCount?})`：提炼内置风格、参考 Folium 虹光和 52Hz。个性/personality 与样式/lyric-template 只是制作标签，不写入标准清单，也不改变宿主 UI。
4. 用现有 `npm run folium:new -- <folder>` 创建模组；使用公开 Folium API 与相对模块。
5. `folium_check_mod({directory})`：调用现有 `dev/folium/check.mjs`，返回清单、权限、文件等检查发现。相对目录从服务仓库根解析；不执行、安装、签名或启用模组。受分析资源预算限制：16 MiB、600 个目录项、24 层、无符号链接、10 秒；更大模组直接使用原 CLI。此预算不改宿主格式规范。
6. 在真实 Folia 桌面版重载、确认启用并选择 visualizer，检查播放、静态预览、暂停/seek/切歌、字号/主题和资源释放。模组是可信代码，不是沙箱；文件改变后是否重新确认由宿主管理。
7. `folium_review_motion({source, phrases})` 诊断已采样轨迹的机械重复；不打开视频、不核实证据文件、不自动授予美术合格。格式、运行、视觉和适配分开记录。

`folium_status({})` 报告服务与 Folium 版本。资源 URI 使用 `folium-authoring://<topic>`；prompt `folium_director` 和 brief 共享指导。不支持资源或 prompt 的客户端可仅通过 tools 完成读取。

## 贡献与范围

主项目提案只含制作 MCP、审美指导和协议测试。它不运行媒体识别模型、不自动生成代码、不操作用户播放器。视频先由作者观察并提供时间点；素材重建经验仅保存方法，不携带第三方原画。

成品模组按[现有贡献指南](contributing.md#6-发布到模组市场)提交到 folium-compound。独立调试器与安装工具分开维护；模拟预览不替代真实桌面宿主验收。运行测试或轨迹诊断始终不能代表艺术验收。

```sh
npm run typecheck
npm run test:unit -- test/unit/folium/authoringMcp.test.ts test/unit/folium/authoringCompatibility.test.ts
```

这些测试覆盖真实 stdio / HTTP SDK 连接、资源与 prompt、tools-only 分页、同源检查器、静态不执行、输入与体积边界、配置启动和客户端断开隔离。
