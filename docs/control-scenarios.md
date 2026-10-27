# 为什么需要进程外的控制面

命令面板已经能执行应用内几乎所有动作，为什么还要 CLI / 回环 HTTP / MCP 这一层？

判断标准只有一条：**这个场景，没有控制面就做不到。**

> 面向评审与后续维护者。改动工具集时，请顺手确认本文四个前提是否仍然成立。

## 1. 读回：palette 的 execute 没有返回值

`CommandPaletteCommand.execute(input, context)` 在面板里执行时，产出是布尔或 void——面板只需要
知道命令是否执行成功，不需要把结果交给任何人。

外部 agent 的需求正相反：它必须知道**做了什么、现在是什么状态**。

```
用户：随便放首周杰伦，然后告诉我现在在放哪首
```

- palette 路线：人能按快捷键、输入歌名、选中，但 agent 拿不到「现在在放哪首」。
- 控制面：`folia_search` 返回结果数组 → `folia_play` → `folia_state` 读回 playback 段确认真的切过去。

没有 `folia_state` / `folia_status`，这条请求断在第二步：agent 会以为放成功了，实际可能因为
provider 未登录而静默失败（`playback_failed`）。

## 2. 时序：palette 里没有「等一会儿」

`folia_events` 返回环形缓冲（500 条，`seq` 从 1 单调递增），并支持 `waitMs` 最长 10 秒长轮询，
因此可以把控制面写成 watch loop。

```
用户：放这张列表，音量每 5 分钟降 10%，降到 20% 就停，全部放完关掉应用
```

```
folia_events {since: cursor, waitMs: 10000}
  → playback.songChanged  → 累计已播曲数
  → queueChanged          → 剩余曲数
  → 剩余 0                → folia_settings_write 音量 → folia_quit
```

关键在于 `playback.songChanged` / `queueChanged` 是**事件**，不是可轮询的字段。人可以听到歌放完
再按下一首，但「等它自己放完」在面板里不存在：面板是人的输入设备，没有输入就没有事件。

## 3. 参数：palette 只接受一个字符串

`CommandPaletteCommand` 的输入模型是 `input: string`（面板里那一行输入框）。

```
用户：把队列里第 7 首挪到当前这首后面
```

- palette：`queue.moveToNext` 只对「当前选中项」生效，无法指定「第 7 首」。
- 控制面：`folia_queue_move {from: 6, toNext: true}`。

同类：`folia_lyric_seek {lineIndex: 12}`（跳到第 13 行歌词）、`folia_volume {level: 20}`、
`folia_seek {percent: 50}`、`folia_queue_remove {indices: [3, 8]}`。这些在面板里都是「拖滑块 /
点按钮」，没有可表达的位置参数。

## 4. 进程边界：这是「必须」的字面答案

前三类是能力差距，这一条是**入口差距**。

命令面板唯一的入口，是应用处于前台时由人按键（或点菜单）触发。应用之外的任何东西——终端、
CI、Claude Code / Codex 这类外部 agent——都没有办法触发一次面板命令。

而下面这些场景，人根本不在场：

| 场景 | 谁在驱动 | palette 可行性 |
| --- | --- | --- |
| 动画/主题作者自测「12 种背景下可视化不崩」 | 脚本循环：`folia_visualizer_list` → `background_set` × 12 → `screenshot` × 12 | 无入口 |
| 夜间播放 + 音量渐降 + 播完退出 | 定时任务 / 脚本 | 无入口 |
| 外部 agent：「放首适合写代码的歌，顺便截图看看动画」 | Claude Code / Codex 调 MCP | 无入口 |
| CI 里跑播放回归，断言 `state.playback.status === 'playing'` | 测试进程 | 无入口 |
| 批量修 60 首歌的歌词偏移 | 一次性脚本，每首 `settings_write` 后回读 | 无入口 |

所以这一层的定位不是「给已有命令做第二套写法」，而是**给应用装一个可以被程序触发的入口**，
顺带补齐读回、时序、参数这三件事。

## 5. 那为什么还要保留 `folia_palette_run`

因为不该重复实现第二套动作。

面板的 70 条命令里，凡是「无返回值、无位置参数、人按一下就行」的（切主题、开关某个开关、
导出歌词、打开某个 picker），控制面一律不单独出工具：

```
folia_palette_list {query: "theme"}   → 找到 id
folia_palette_run  {id: "theme-generate-current"}
```

catalog 只保留三类工具：

1. **读**：`state` / `status` / `queue` / `lyrics` / `settings_read` / `search` / `library` /
   `providers` / `events` / `visualizer_list` / `tools`
2. **带位置参数或需要回读确认的动作**：`queue_*` / `seek` / `lyric_seek` / `lyric_offset` /
   `volume` / `settings_write` / `visual_tuning`
3. **主进程侧、渲染进程做不到的**：`screenshot`（base64 PNG）、`quit`

动作类工具进入 catalog 的条件：要么需要位置参数，要么调用后必须能读回结果确认。其余走直通。

## 6. 哪些「看起来重复」但其实没有面板命令

评审时最容易误判的一类。按 `src/components/command-palette/commands/` 的 70 条命令 id 对账，
以下能力在面板里**没有对应命令**，工具是唯一入口：

| 工具 | 面板侧现状 |
| --- | --- |
| `folia_transport` 的 `next` / `prev` / `toggle` / `stop` | 只有 `playback-play` / `playback-pause` |
| `folia_loop` | 无命令（只有 UI 上的循环按钮） |
| `folia_shuffle` | 无 |
| `folia_like` | 无 |
| `folia_replaygain` | 无 |
| `folia_lyric_offset` | 无 |
| `folia_smart_beat` | 无 |
| `folia_navigate` | 无（面板里有 `lattice-focus-current` 等，但没有主视图切换） |
| `folia_settings_open` | 无（设置页不是命令） |
| `folia_window` 的 `minimize` / `maximize` / `close` | 只有 `browser-fullscreen` 与置顶开关 |

真正 1:1 对应的是少数：`folia_volume`↔`playback-volume`、`folia_queue_clear`↔
`playback-clear-queue`、`folia_visualizer_set`↔`visualizer-picker:<mode>`、
`folia_background_set`↔`background-picker:<mode>`、`folia_sleep_timer`↔`sleep-timer`。
这些保留，是因为 CLI / MCP 侧需要稳定的参数名与返回值（`palette-run` 只有一个 `input` 字符串）。

## 7. 安全边界

- HTTP 只监听 `127.0.0.1`，端口默认 4567，被占则 +1 到 +9。
- Bearer token，来自 `FOLIA_CONTROL_TOKEN` 或 `<userData>/control-token`（0600，32 字节 hex）。
- server 默认不启动，由设置页显式开启。
- `destructive` 工具（`folia_queue_clear`、`folia_quit`）要求显式确认参数。
- **不提供**在渲染进程执行任意 JS 的能力：catalog 里没有 eval 类工具，`/invoke` 只调度
  handler 表里的实现。
