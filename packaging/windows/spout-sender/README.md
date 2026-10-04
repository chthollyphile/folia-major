# folia-spout-sender

Windows 下的 Spout2 输出辅助进程。由 Electron 主进程 spawn：主进程把现有的 OBS 浮层页面
（`/obs?obs=1&token=...`）渲染进一个隐藏的离屏 `BrowserWindow`（`offscreen.useSharedTexture`），
每一帧 `paint` 得到一个 D3D11 NT 共享句柄；本进程把该句柄复制进自己，拷贝到自己的 Spout
共享纹理里，并以 Spout2 sender 的身份发布，OBS 的 obs-spout2-plugin（"Spout2 Capture"）即可把
它当作带 alpha 的 GPU 纹理采集，而不必走 Browser Source。

不链接 Spout SDK：在 Rust 里按字节兼容地重现一个 Spout 2.007 DirectX sender 做的事。

## 协议

命令行：`folia-spout-sender.exe --name "<sender name>" --parent-pid <electron main pid>`
（未知选项 / 缺参数一律报错退出，`--name` 须为 1..255 字节、不含 NUL、首字节为 ASCII）。

stdin（命令）/ stdout（事件）/ stderr（自由日志），均为 UTF-8 JSON，一行一个对象，camelCase：

```
stdin : {"type":"frame","id":<u32>,"handle":"<NT HANDLE 十进制字符串，属于父进程>",
         "codedWidth":..,"codedHeight":..,"x":..,"y":..,"width":..,"height":..,"format":"bgra"|"rgba"}
        {"type":"stop"}
stdout: {"type":"ready","senderName":"<name>"}
        {"type":"done","id":<u32>}                        // GPU 拷贝已完成，Electron 可以 release 纹理
        {"type":"frameError","id":<u32>,"message":".."}   // 本帧失败，进程继续运行
        {"type":"fatal","code":"name-in-use"|"d3d-init-failed"|"spout-register-failed"|"bad-args","message":".."}
```

- 每个 `frame` 恰好得到一个 `done` 或 `frameError`，按顺序，id 相同。格式不对但能读出 id 的
  `frame` 行也会得到 `frameError`。
- 退出（先注销 sender，退出码 0）：stdin EOF、`{"type":"stop"}`、或 `--parent-pid` 进程退出。
- `format:"rgba"` 当前直接回 `frameError`（没有实现 swizzle shader）；Electron 必须请求 `bgra`。
- `fatal` 之后进程以非零退出码退出（命令行参数错误为 2，运行期 fatal 为 1）。

实现见 `src/protocol.rs`（行协议）、`src/cli.rs`（参数）。

## 每帧流程（`src/sender.rs`、`src/gpu.rs`）

1. `OpenProcess(PROCESS_DUP_HANDLE)` 的父进程句柄 → `DuplicateHandle` 把 NT 句柄复制进本进程。
2. `ID3D11Device1::OpenSharedResource1`。失败（Chromium 很可能不在默认适配器上）则枚举其它硬件
   DXGI 适配器逐个重试，成功的那个成为当前设备（Spout 纹理随之在该设备上重建并改写 sender 信息）。
3. 取纹理访问互斥量 `<name>_SpoutAccessMutex`（67 ms，与 SDK 相同）。
4. 可见区域尺寸变化 → 重建 Spout 纹理（`B8G8R8A8_UNORM`）并重写 sender 信息。
5. 若源纹理带 keyed mutex 则 `AcquireSync(0)`；`CopySubresourceRegion` 拷贝可见区域；`Flush`；
   `D3D11_QUERY_EVENT` 等 GPU 完成（上限 2 s）；`ReleaseSync(0)`。
6. 若注册表开启了 Spout 帧计数（见下），递增帧计数信号量；释放访问互斥量；关闭复制出的句柄；回 `done`。

## 与 Spout 2.007 SDK 的对应关系

参考实现是 `SpoutSenderNames.cpp`、`SpoutSharedMemory.cpp`、`SpoutDirectX.cpp`、
`SpoutFrameCount.cpp`（均为 Spout 2.007.x）。

| 对象 | 名称 / 内容 | 实现 |
| --- | --- | --- |
| sender 名称列表 | 文件映射 `SpoutSenderNames`，大小 `MaxSenders * 256`；互斥量 `SpoutSenderNames_mutex`；每个名称占 256 字节槽，按字节序排序，NUL 结尾，列表未满时下一槽首字节写 0 | `sender_names.rs`（编解码，纯逻辑）、`spout_registry.rs` |
| `MaxSenders` | `HKCU\Software\Leading Edge\Spout\MaxSenders`（DWORD），缺省 / 0 → 64，上限钳到 4096，并按映射实际大小再钳一次 | `sender_names::resolve_max_senders` |
| 活动 sender | 文件映射 `ActiveSenderName`（256 字节，NUL 结尾名称），注册时写入自己；注销时若自己是活动 sender（或只剩一个）则改为列表第一个 | `spout_registry.rs` |
| sender 信息 | 文件映射 `<name>`（280 字节 `SharedTextureInfo`）+ 互斥量 `<name>_mutex`：`shareHandle(u32)`、`width`、`height`、`format`(=87)、`usage`(=0)、`description[256]`（宿主 exe 路径）、`partnerId`(=0) | `shared_info.rs`（字节布局，纯逻辑） |
| 共享纹理 | `D3D11_RESOURCE_MISC_SHARED`、`RENDER_TARGET\|SHADER_RESOURCE`、`DEFAULT` usage、BGRA；句柄来自 `IDXGIResource::GetSharedHandle`（旧式全局句柄，取低 32 位） | `gpu.rs` |
| 访问互斥量 | 命名互斥量 `<name>_SpoutAccessMutex` | `frame_sync.rs` |
| 帧计数 | 命名信号量 `<name>_Count_Semaphore`，仅当 `HKCU\...\Spout\Framecount == 1` 时创建（SDK 默认关闭），每帧在访问锁内 `Wait(0)` + `Release(2)` | `frame_sync.rs` |

锁顺序沿用 SDK：名称列表互斥量是外层锁（`RegisterSenderName` / `ReleaseSenderName`），活动 sender
映射在其内部访问；sender 信息映射只单独加锁、从不嵌套在列表锁里（与 `UpdateSender` 一致）。
每帧：访问互斥量 → （重建时写信息映射）→ 拷贝 + 等 GPU → 帧计数 → 释放。

名称按原始字节处理（Electron 传来的 UTF-8），`CreateFileMappingA` 等 `*A` API 与 SDK 一致。

### 有意与 SDK 不同的地方

- **先建信息映射并写好内容，再把名字登记进列表**（SDK 是先登记再建映射）。这样接收端或别的 SDK
  程序的 `GetSenderCount` 不会看到“已登记但没有信息映射”的 sender 而把它清掉。
- **同名且信息映射已存在 = 有活着的 sender → `fatal name-in-use`**，而不是 SDK 的 `Name_1` 自动改名
  （契约要求 `name-in-use`）。崩溃遗留的列表项没有映射，会被直接覆盖。
- 列表满 / 锁超时是错误（`spout-register-failed`），SDK 是静默跳过注册。名称列表加锁最多重试 8 次 ×67 ms。
- 废弃（abandoned）互斥量视为获取成功（SDK 视为失败且不释放）。
- 首字节 >= 0x80 的名称被拒绝（`bad-args`）：SDK 读取列表时按有符号 `char` 判断 `name[0] > 0`，
  这样的名字会被当成列表终止符，所有接收端都会看不到它。
- 启动时尚不知道真实分辨率（命令行只有 `--name` / `--parent-pid`），先以 1920×1080 的透明纹理登记
  并发 `ready`，第一帧到达时若尺寸不同则按 `UpdateSender` 的方式重建。

## 构建与测试

Windows 上 `cargo build --release`（由 `packaging/windows/build-spout-sender.mjs` 驱动，产物复制到
`build/folia-spout-sender.exe`，非 Windows 主机上该脚本直接跳过）。`windows` crate 按
`cfg(windows)` 门控，纯逻辑模块（`cli` / `protocol` / `sender_names` / `shared_info`）可在任意平台
`cargo test`；Windows 专属模块（`shared_memory` / `spout_registry` / `frame_sync` / `gpu` /
`sender` / `runtime`）可用 `cargo check --target x86_64-pc-windows-gnu` 做类型检查。

## 代码来源与许可

本 crate 随 Folia 以 **AGPL-3.0** 发布。Spout 协议（共享内存布局、对象命名、加锁顺序）按 Spout2
SDK 2.007 的行为重现，实现为独立的 Rust 代码，不含 SDK 源码；SDK 的版权声明如下：

| 模块 | 参照 | 许可证 |
| --- | --- | --- |
| `sender_names.rs`、`shared_info.rs`、`spout_registry.rs` | Spout2 `SpoutSenderNames.cpp/.h` | BSD-2-Clause，Copyright (c) 2014-2025, Lynn Jarvis |
| `shared_memory.rs` | Spout2 `SpoutSharedMemory.cpp` | BSD-2-Clause，Copyright (c) 2014-2025, Lynn Jarvis |
| `gpu.rs` | Spout2 `SpoutDirectX.cpp`（`CreateSharedDX11Texture`、`FlushWait`、`CreateDX11device`） | BSD-2-Clause，Copyright (c) 2014-2025, Lynn Jarvis |
| `frame_sync.rs` | Spout2 `SpoutFrameCount.cpp` | BSD-2-Clause，Copyright (c) 2019-2025, Lynn Jarvis |
