# Apple Music companion

独立运行的 Apple Music 网页播放器。Folia 的主 Electron 不变；这个进程在它自己的窗口里加载
`music.apple.com`，用 Apple 自己的网页完成登录，并把搜索、个人歌单和歌词交给 Folia。Apple 的
音频受 DRM 保护，只在它的页面里发声：Folia 通过受限 IPC 让它播放、暂停、跳转，并跟随它报告的
位置。凭据只留在这个进程的隔离 profile 里。

## 组成

- `companion.cjs`：窗口、导航白名单和受限请求分发。窗口都开 `sandbox`、`contextIsolation`，
  关闭 `nodeIntegration`；导航只允许 Apple 的音乐和登录主机。
- `companionPlaylist.cjs`：重新读取目标歌单的编辑权限，再追加目录歌曲；不自动重发可能已成功的追加请求。
- `companionFavorites.cjs`：只对固定歌曲 ID 发喜爱/取消喜爱请求，不接收任意 URL、方法或凭据。
- `companionQueue.cjs`：维护最多两首后继的原生队列；顺序推进复用已开始的歌曲，滚动追加保留现有缓冲，队列编辑只替换待播部分。
- `companionRequests.cjs`：父进程能发的全部操作白名单、参数校验，以及注入网页执行的读取函数。
  返回的字段是固定的几项，不转发原始响应、token 或账号标识。
- `companionClient.cjs`：Folia 主进程这一侧的客户端。子进程只经继承的 IPC 通道通信，不监听网络。
- `companionRecovery.cjs`：播放控制超时后先导航到空页面销毁旧播放器，再恢复原页面；恢复失败则关闭 renderer，避免旧命令晚到后出声。恢复不清除会话。
- `companionSession.cjs`：退出登录时先离开页面，再清空这个 profile 的存储。
- `companionNavigation.cjs`：允许导航的主机名单。

## 开发时启动

正式交付的打包与自动启动尚未完成（见任务清单 6.2）。开发时需要一个能完整播放 Apple Music 的
CastLabs Electron 运行时（普通 Electron 没有 Widevine）。本机已准备好的开发运行时在
`~/Library/Caches/folia-runtimes/castlabs-electron-v43.7.7/Electron.app`（43.7.7+wvcus，首次启动由
组件更新器安装 Widevine CDM；`companion.cjs` 会等 `components.whenReady()` 再开窗口）：

1. 把 CastLabs Electron 的可执行文件路径放进 `FOLIA_APPLE_MUSIC_ELECTRON`。
2. 用 `ELECTRON_DEV=true` 启动 Folia（例如 `npm run dev:electron` 时补上这个变量）。
3. Folia 第一次需要这个进程时会在 `userData/apple-music-companion` 这个 profile 下把它启动成
   隐藏窗口；DEV 与正式版采用同一后台窗口策略。仅显式发起登录时显示，登录完成或取消后隐藏所有 companion 窗口。macOS 使用 accessory 激活策略，不显示 Dock 图标或独立应用菜单；其他平台窗口设置 skipTaskbar。
4. 读到账号后，companion 会先导航到账号自己的 storefront 再回答；MusicKit 只按页面地区解析目录 id，
   页面地区和账号不同时会接受播放请求却不真正开始。

这个开发构建使用 CastLabs 的 development VMP 签名，不能把 Widevine 安装成功当作 Apple Music
可播放的证明。[CastLabs](https://github.com/castlabs/electron-releases) 说明默认签名用于开发服务器；
[Sidra 的 VMP 说明](https://github.com/wimpysworld/sidra#widevine-vmp-signing) 明确要求 macOS/Windows
使用生产 VMP 签名。用户已确认当前 companion 网页直接播放也失败，生产签名是优先排查项；
尚未拿到本次 DRM 错误或完成生产签名后的对照，不能认定为唯一原因。登录、搜索、歌单和歌词
属于数据路径，成功不代表受 DRM 保护的音频可播放。EVS/VMP 签名与 Apple Developer token 是两回事。

单独启动这个脚本（下面的命令）只会打开一个网页窗口，没有父进程的 IPC 通道，不能服务 Folia：

```bash
<castlabs-electron> "$PWD/electron/appleMusic/companion.cjs" --user-data-dir="$PWD/test-results/apple-music-companion-profile"
```

不要提交 profile，也不要分享其中的凭据。网页和登录流程可能更改；导航白名单要随真实登录验证调整，
不能因为登录失败就关闭沙箱、节点隔离或网页安全设置。

## 未验证

自行构建的运行时播放失败过，原因尚未确定；正式运行时的签名、EVS、Widevine / VMP 和完整播放
需要在 macOS、Windows、Linux 上分别用真实账号验证。上层读取（登录、搜索、个人歌单、TTML）已经
在真实账号的网页会话里取得过，但经过这个进程的端到端流程仍需真人验收。

## 播放故障恢复与诊断

播放命令共用串行队列。任何网页请求 20 秒内没有完成时，旧队列作废，排队中的命令不再执行；恢复期间返回
`not-ready`，由父进程在请求期限内重试。旧页面先被替换成空页面，再载入原 Apple Music 地址，
新的页面建立后才能接收控制。只读请求同样触发恢复，避免搜索或状态查询永久占满名额，堵住播放控制；页面恢复会中断当前播放，需要重新点播。恢复超过 8 秒或导航失败时关闭 renderer，让父进程按需重启。
网页操作通过 Electron 的用户手势标记执行，以支持 Folia 点击触发的播放。

起播分别记录固定的 `Playback stage: queue`、`Playback stage: play` 标签。日志停在前者说明设置
队列没有完成；到达后者再超时说明等待播放阶段没有完成，仍需结合运行时/DRM 检查判断原因。
远程页面的任意错误正文不转发，只记受限的阶段标签、拒绝和 DRM 相关消息提示，避免暴露凭据。
这些诊断标签不代表 DRM 已通过，也不代表已开始整首播放。
播放失败会在 renderer 错误中附上固定阶段（prepared-queue / configure / queue / play / seek）。
预备队列的快速切换被拒绝时，回退一次正常加载；若目标已播放则沿用，正常加载仍失败时不无限重试。

## 本机生产签名对照结果（2026-10-31）

用户完成 EVS 注册后，使用 `castlabs-evs==1.3.2` 对上述本机运行时做生产 `streaming` VMP 签名，
`verify-pkg` 验证通过。相同账号会话、歌曲和中国大陆地区，签名前许可证返回 `-42585/-1021`，
签名后许可证状态与错误码均为 0，密钥更新成功，播放时钟推进至 31 秒。Folia 已配置的原运行时
也已应用有效签名，无需改路径。该结果只覆盖当前 macOS 运行时与测试歌曲；整首播放、控制、
歌词同步和正式分发仍需分别验收。签名和 EVS 配置均保存在本机，不提交凭据到仓库。

## 顺序播放预准备（2026-11-01）

Folia 经 Omni 将同平台连续后两首交给 companion。MusicKit 使用 `playLater` 准备原生队列，
自动进入已批准的后继后，Folia 接管它而不重新 `setQueue`。后继滚动追加；插队、删除、循环模式
变更会同步待播部分。跨平台、私人 FM、单曲循环、重复目录 ID 等边界退回 Folia 原有单曲控制。
已使用的当前歌曲重播仍重新起播；接管已暂停的后继保留暂停。尾部准备不能阻塞暂停请求。

当前网页的 `queue.clearAfterCurrent` 为运行时探测出的能力，非已确认稳定的公开契约；缺失时
预准备返回不可用，正常单曲点播继续工作。更新 MusicKit 网页或运行时后需复验该能力。
真实隔离会话验证了准备队列、自动 A→B 与 `reusedQueue: true` 的接管，B 时钟持续推进；未做
零延迟/无缝的量化保证。音频和许可证缓冲仍由 Apple 播放器控制，不向 Folia 提供音频直链。

## 避免交接后重复起播

每次播放携带受限的稳定 `requestKey`，桥接重试同一次请求时不会重新设置队列。Folia 已观察到的
原生后继可请求 `adoptCurrent`；页面仍须核验当前目录 ID，一致时接管，不一致则正常点播。
手动切到已准备条目由 `changeToMediaAtIndex` 发起，不再紧接着补一次 `play()`。重复目录 ID
出现在历史中时，仅选择当前位置及后方的准备条目。冷启动显示“正在准备播放…”，准备后的
交接省略加载链接提示；准备队列并不保证音频已缓冲，不能承诺任意点击零延迟。

## 后台窗口策略（2026-11-01）

companion 无论 DEV 与否都以 `show: false` 启动，不注册托盘图标。macOS 在入口立即设置
`accessory` 激活策略；主窗口及登录子窗口均设置 `skipTaskbar`。隐藏状态下不允许网页自行打开
可见登录弹窗。Folia 的显式登录操作显示主窗口及已有登录子窗口，登录结束或取消后全部隐藏。
正式版的 companion 配套打包/分发仍未完成；这里统一的是窗口策略，不代表正式安装包已验收。

## 喜爱歌曲同步

歌单请求带 `extend: tags`，只按 `favorited` 系统标签识别喜爱歌单，不按名称猜测。
账号同步时读取其全部分页（本轮最多 10000 条；超过上限标记未读全）；某页失败保留原缓存，
找不到系统歌单时不将已有喜爱清空。主页面返回或重新进入资料库时沿用 Omni 的账号刷新时机，
不是 Apple 的实时推送。

Folia 的爱心使用 `v1/me/favorites` 的 POST / DELETE，参数固定为 `ids[songs]`；沿用网页自己的
已登录会话，凭据不离开 companion。取消喜爱不发删除资料库歌曲的请求；添加喜爱是否同时加入
资料库由 Apple 的账号设置决定。资料库歌曲和搜索结果用目录 ID 作为同一个喜爱身份，播放身份不变。
没有目录映射的上传歌曲暂不支持写入喜爱。

已验证：真实隔离会话识别系统喜爱歌单并分 4 页读取 340 条曲目资源；单测和真实 Electron 本地模拟页面验证请求、分页及错误处理。
尚未验证：在真实 Apple 账号中从 Folia 加入/取消喜爱，再到官方客户端核对及反向修改后刷新。

## 加入歌单

沿用 Folia 的「加入歌单」选择器。只有 `canEdit: true` 的 Apple 资料库歌单可被选择；
系统喜爱歌单和唯读/权限未知歌单不作为加入目标。旧缓存没有编辑权限时，刷新账号歌单后才显示。
companion 在提交前再次请求歌单详情并核对权限，随后按官方网页的 POST
`v1/me/library/playlists/<id>/tracks` 请求追加目录歌曲，最多 100 首。资料库歌曲先取目录映射；
没有映射的上传歌曲暂不支持。追加成功后使用 Omni 现有的歌单刷新流程，Apple 侧可能延迟显示。

本次仅开放追加，普通歌单删除/排序和创建歌单尚未实现。发送追加后连接中断或页面切换时，
不自动重试，避免重复加入；应先查看歌单结果再由用户决定重试。
单测和隔离 Electron 本地模拟页面验证了请求与权限处理；真实账号写入仍需验收。

## 歌单曲目数量

Apple 的资料库歌单列表不提供曲目总数。`playlistTrackCount` 只请求 tracks 的 1 条记录，
取 `meta.total` 作为 `trackCount`，不把当前页长度当总数。读取账号歌单时最多两个数量请求并行；
内部寻找喜爱歌单时省略这些可选请求。单个数量查询失败只留下未知，不丢掉歌单。
「加入歌单」界面对未知数量不显示数字，确认总数为 0 时才显示 0。
真实隔离会话验证一份歌单返回 total=63、loaded=1；未改变用户数据。
