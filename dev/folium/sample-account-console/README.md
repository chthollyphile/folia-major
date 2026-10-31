# 账号与消息样例（sample-account-console）

需要 Folium 1.7（桌面版）。在模组设置里加一个密钥字段，在首页加一个「账号与消息」页面：显示密钥有没有填（client 和
main 入口各读一次，不显示值）、main 入口推来的消息、当前音源的登录状态，以及用实验接口 `platform.raw` 读到的网易云听歌排行。
另有一条可以绑到系统级全局快捷键的命令「让 main 入口回一声」（`globalShortcut`）。

权限：`platform.netease.read`（`platform.raw` 读网易云的只读接口）。实验接口：`platform.raw`（清单里不选用它就声明
`platform.*` 权限，清单校验不通过）。密钥字段、`rpc.send` / `rpc.on`、`folium.account`、命令的 `globalShortcut` 都不需要权限。

听歌排行要在 Folia 里登录网易云；不登录也能看其余三张卡片，听歌排行那张会显示「没有登录这个平台」（`not-signed-in`）。

## 安装

这个目录**没有签名**，开发版也**不会自动扫描** `dev/folium/`，需要手动安装（装好后在模组面板里显示为「未验证」）：

- **打 zip 拖进去**：把整个目录打成 zip，拖到模组面板上。`mod.json` 在 zip 里唯一的顶层文件夹里也可以：

  ```powershell
  Compress-Archive -Path dev/folium/sample-account-console -DestinationPath sample-account-console.zip
  ```

- **复制到用户模组目录**：模组面板右上角「打开模组目录」，把 `sample-account-console` 目录复制进去，再点「重载」。
- 开发时也可以临时复制到仓库的 `mods/` 下，享受开发目录「改了文件不用重新确认」的豁免；但不要提交到那里：`mods/` 里的模组必须带官方签名，
  `test/unit/mod-system/sampleMods.test.ts` 会失败。

然后在模组面板里启用「账号与消息（样例）」并确认。确认窗口会多一行「以你的账号读取平台数据（实验接口 platform.raw）：netease」，
模组面板展开这一行时也有同样意思的一句。

## 试用

1. 在 Grid 或 Bravais 首页的导航里选「账号与消息」，或在命令面板里运行「打开账号与消息」。
2. **密钥字段**：在模组面板展开这个模组，设置里有「示范 API 密钥」（密码框）和「听歌排行的范围」。填一段文字保存：
   - 设置里只显示「已设置」和「清除」，保存过的值不再显示；
   - 页面的「client 读到」「main 入口读到」都变成「已设置」。前者是 `folium.secrets.subscribe` 收到 key 后 `has` 的结果，
     后者是 main 入口的 `api.secrets.subscribe` 收到 key 后 `get` 一次、再用 `secretStatus` 消息告诉页面的结果；
   - 「settings.get() 里的键」只有 `range`：`secret` 字段的值不在设置值里，也不进视觉配置的导出和导出窗口；
   - 页面上的「清除密钥」调 `folium.secrets.set('apiKey', null)`，设置里随之变成「未设置」。

   每次启动 Folia，main 入口都比 client 先启动，宿主那时还不知道 `apiKey` 是密钥字段：没填过的 `apiKey` 读出来是 `null`，
   开发者日志里那一行写「secret field unset」；填过的照常读到，写「secret field set」。
3. **main 入口的消息**：「来自 main 入口的消息」每 15 秒多一条 `heartbeat`。点「让 main 入口回一条消息」：client 调
   `rpc.call('ping')`，main 入口在处理函数里 `api.rpc.send('pong', …)`。消息不排队：页面关着时收到的照样记下（监听属于模组，不属于页面），
   模组重载之后 client 先 `rpc.on` 再 `rpc.call('status')` 取一次 main 入口的状态。
4. **登录状态**：卡片显示宿主当前选中的在线音源（`folium.account.getState()`）：昵称、头像、`accountKey` 的前 8 位。
   在宿主里退出、登录或换号，卡片跟着变，并写下最近一次 `account.changed` 的时间。只改昵称或头像不发这个事件。
5. **听歌排行**：卡片写着宿主钉住的后端库名和版本（`describe`）。点「读取」：`request('netease', 'user_record', { type })`，
   列出前 10 首和播放次数。`uid` 不用给，宿主填当前账号的 id，模组拿不到它。排行记在读的那个账号的 `accountKey` 下，
   换号时（`account.changed` 带来新的 `accountKey`）丢掉，在设置里改范围时也丢掉，再点「读取」重新读。
   失败时显示错误码对应的说明（`not-signed-in`、`rate-limited`、`account-changed` 等）。平台用别的 `code` 拒绝时（登录失效和限流之外）
   不算失败，回答原样作为原始 JSON 交回来，页面显示其中的 `code`。

   回答是平台的原始 JSON，跟着宿主钉住的后端库变，不承诺稳定；页面按字段逐个读，读不到就当没有。

6. **系统级全局快捷键**：打开「设置 → 快捷操作 → 全局快捷键」，在某个槽位的命令下拉框里，播放命令后面有
   「账号与消息（样例） · 让 main 入口回一声」。选它，再给这个槽位按下组合键（自己选修饰键，至少一个）。
   把 Folia 切到后台，按那个组合键：应用里弹出「main 入口已回 pong」的提示，页面的「来自 main 入口的消息」多一条 `pong`。
   - 在模组面板停用这个模组：那一行写「模组未启用。启用后这个键会自动恢复」，键松开、按了没反应，绑定不丢；重新启用后键自动回来。
   - 这条命令没有参数，宿主才会列出它；`run` 拿到的 `values` 是空对象，结果不显示，所以命令自己 `folium.ui.toast`。
     main 入口没在运行时 `rpc.call` 会失败，失败记进模组面板里这个模组的故障记录，不弹窗。
   - 原生 Wayland 下设置页只有「注册到桌面环境」那一个按钮，不列模组命令。

## 演示了哪些 1.7 接口

| 接口 | 在哪 |
| --- | --- |
| 设置字段 `type: 'secret'` | `client.mjs` 的 `activate`：设置区块里的 `apiKey`，旁边是普通的 `range` |
| `folium.secrets.has` / `set` / `subscribe` | `createDesk`、「清除密钥」按钮 |
| `api.secrets.get` / `subscribe` | `index.cjs` 的 `readSecretStatus`：activate 里（client 登记之前）读一次，之后跟着变化读 |
| `api.rpc.send` | `index.cjs`：定时的 `heartbeat`，`ping` 处理函数里的 `pong`，密钥变化后的 `secretStatus` |
| `folium.rpc.on` | `createDesk`：先登记三个监听，再 `rpc.call('status')` 取一次状态 |
| `folium.account.getState()` | 「登录状态」卡片，每次重画都读（宿主换了选中的音源不发事件） |
| `account.changed` | `createDesk`：重画，换号时丢掉旧账号的排行 |
| `experimental['platform.raw']` 的 `describe` / `request` | 「听歌排行」卡片；`signal` 在换号、改范围、再次读取和模组停止时中止旧请求 |
| 命令的 `globalShortcut: true` | `client.mjs` 的 `activate`：`ping` 命令，没有参数，`run` 里 `rpc.call('ping')` 后 `folium.ui.toast` |

`test/unit/mod-system/devFoliumSamples.test.ts` 校验清单，用真实的 `createModApi`（替身密钥存储）跑 main 入口，
并在 jsdom 里用一个替身 `folium` 跑 client 页面。
