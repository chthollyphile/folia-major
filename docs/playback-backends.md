# 播放后端与独立模组

宿主改造入口是 `src/services/playbackBackend/`，不依赖具体引擎。Folium 边界在 `src/mods/folium/playbackBackends.ts`；模组声明 `playback.backend` 权限和 `playback.backends` 实验 opt-in 后，在主窗口通过 `folium.experimental['playback.backends'].register` 注册。完整结构类型来自 `contract.ts`，编辑后运行 `npm run folium:types` / `npm run folium:api`，不手改生成文件。

契约：`create(report)` 创建会话，`open` 准备暂停输出，`play/pause/seek/setVolume/dispose` 操作它；事件带每次加载唯一的 `sourceId`。实际输出遥测将 `exclusiveRequested` 与 `exclusiveActive` 分开；模组应依据设备确认，而不是照抄开关。宿主过滤退休会话/音源的事件，序列化准备与清理，使用原生时钟驱动既有 MotionValue 帧循环。

注册不等于启用后端。用户在「设置 → 播放 → 播放后端」中显式选择；默认保持 Web Audio，选择不持久化。选中模组被撤销时暂停并保留“不可用”选择，不能偷偷换输出。外部输出期间不挂浏览器音源，并旁路宿主 EQ、ReplayGain、automix 与淡入淡出。切换输出会暂停，释放前一个设备后才允许新会话初始化。

HTTP 能力后端可直接接收宿主已经解析的地址；其他源通过 `playbackSources` preload 服务暂存原始字节（不经过浏览器解码）。IPC 仅允许受信任主窗口主 frame，释放仅接受当前 store 铸造的 ID，不接受任意路径。文件上限 512 MiB，暂不流式送入原生引擎；大型文件和在线地址过期仍需改进。模组安装容许原生引擎，ZIP 最大 128 MiB、单文件 128 MiB、展开总量 256 MiB、文件数 2000，解压和内容摘要仍执行上限与路径校验。

此改造只提供通用宿主接口，不包含具体播放模组。引擎下载、校验、设备选择、DSP 与运行库及许可打包由各模组自身负责，不往宿主塞播放器或 DSP 实现。后续符合契约的模组会自动出现在同一个后端选择器中，无须增加引擎专属的主程序分支。

## 以后接 HQPlayer

同一契约可以让另一模组实现 Signalyst Control API，无须给宿主增加 HQPlayer 分支；本次没有实现或测试 HQPlayer 模组。官方 [Embedded 产品页](https://signalyst.com/hqplayer-embedded/) 与 [下载 / SDK 入口](https://signalyst.com/downloads/) 是接入依据。

适配时仍需处理服务发现/认证、版本能力、播放时钟/seek、错误和断线恢复。远端 HQPlayer 不能读取 Folia 的 blob 或本机暂存路径，需后续设计可访问的媒体服务及访问控制，不能把本地路径直接交给远端。HQPlayer 自己负责滤波/设备输出，宿主不替它宣称独占或 bit-perfect，也不未经用户选择同时启用两条 DSP 链。
