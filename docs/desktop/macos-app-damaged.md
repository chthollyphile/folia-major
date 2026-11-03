# macOS 提示：`Folia.app` 显示“应用已损坏”或“无法验证”

如果你从 GitHub Releases 下载桌面版后，macOS 弹出“`Folia.app` 已损坏，无法打开。你应该将它移到废纸篓”，或者“Apple 无法验证 `Folia.app` 是否包含恶意软件”，通常不是安装包真的坏了，而是因为当前发布的 macOS 版本没有 Apple Developer ID 签名和 notarization。

从浏览器下载的文件会带上 `com.apple.quarantine`（下载隔离）属性。macOS Gatekeeper 只检查带这个属性的应用，未签名或未公证的应用会被拦截，签名不完整时提示文案会显示成“已损坏”。

## 使用前先确认

- 只从官方 Releases 页面下载对应版本的 macOS 安装包，例如 `Folia-0.5.17-arm64.dmg`
- 先把 `Folia.app` 从 dmg 窗口拖到 `Applications`，不要直接在 dmg 挂载盘里运行
- 如果下载过程中中断过，先重新下载一次再试

## 方案一：移除下载隔离属性（推荐）

在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Folia.app
```

如果你的应用不在 `Applications`，把路径改成实际位置，例如：

```bash
xattr -dr com.apple.quarantine ~/Downloads/Folia.app
```

执行后从 `Applications` 重新打开应用即可。这个方法对“已损坏”和“无法验证”两种提示都有效。

macOS 版目前不支持应用内自动更新。每次从 Releases 下载新版本覆盖安装后，新的 `Folia.app` 会重新带上下载隔离属性，需要再执行一次上面的命令。

## 方案二：在“隐私与安全性”里允许

只适用于提示“无法验证”、而不是“已损坏”的情况。Apple 芯片（M 系列）的 Mac 上通常提示的是“已损坏”，请直接使用方案一。

1. 先双击打开一次 `Folia.app`，在弹窗里点“完成”
2. 打开“系统设置”
3. 进入“隐私与安全性”
4. 滚动到页面底部
5. 找到关于 `Folia.app` 被阻止的提示，点击“仍要打开”

然后再回到 `Applications` 启动一次。

提示“已损坏”时这里通常不会出现“仍要打开”，请使用方案一。

> macOS 15 及更新版本已经取消了“按住 `Control` 点击应用 → 打开”的绕过方式，这一步不再有效。

## 如果还是打不开

- 删除当前 `Folia.app` 和已下载的 `dmg`，重新从 Releases 下载
- 确认你运行的是拖拽后的 `Folia.app`，不是 dmg 里的临时挂载版本
- 执行完方案一后，确认是重新从 `Applications` 启动，而不是点之前残留的弹窗
- 带上终端输出和“控制台”(Console.app) 里 `syspolicyd` / `amfid` 的相关报错提交 issue

`spctl --assess -vv /Applications/Folia.app` 对未签名应用总是显示 rejected，这是预期结果，不代表方案一没有生效。

## 为什么现在会这样

目前发布流程会正常打出 macOS 安装包，但还没有接入 Apple Developer ID 签名和 notarization。只要没有这一步，macOS 就会在首次打开时拦截应用，并把签名不完整的应用提示为“已损坏”。

给安装包补一个本地临时签名（ad-hoc）可以让提示变成“无法验证”，但没有 Apple 开发者身份的签名每个版本都不一样，钥匙串会在每次更新后要求重新输入密码才能读取已保存的登录信息，所以在接入 Developer ID 之前不会这样做。

如果后续接入签名与 notarization，这个提示可以随之移除。
