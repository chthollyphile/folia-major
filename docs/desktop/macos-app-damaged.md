# macOS 提示：`Folia.app` 显示“应用已损坏”

如果你从 GitHub Releases 下载桌面版后，macOS 弹出“`Folia.app` 已损坏，无法打开。你应该将它移到废纸篓”，通常不是安装包真的坏了，而是因为当前发布的 macOS 版本还没有做 Apple Developer 签名和 notarization。

macOS Gatekeeper 会把未签名或未公证的应用标成高风险，再加上下载文件自带的 quarantine 属性，就可能把提示文案显示成“已损坏”。

## 使用前先确认

- 只从官方 Releases 页面下载对应版本的 macOS 安装包，例如 `Folia-0.5.17-arm64.dmg`
- 先把 `Folia.app` 从 dmg 窗口拖到 `Applications`，不要直接在 dmg 挂载盘里运行
- 如果下载过程中中断过，先重新下载一次再试

## 方案一：通过 Finder 手动允许打开

1. 打开 `Applications`
2. 找到 `Folia.app`
3. 按住 `Control` 点击应用，选择“打开”
4. 在弹窗里再次选择“打开”

这一步会把它加入 Gatekeeper 的允许列表，后续通常可以正常启动。

## 方案二：在“隐私与安全性”里允许

如果第一次双击后被拦截：

1. 打开“系统设置”
2. 进入“隐私与安全性”
3. 滚动到页面底部
4. 找到关于 `Folia.app` 被阻止的提示
5. 点击“仍要打开”

然后再回到 `Applications` 启动一次。

## 方案三：移除下载隔离属性

如果前两种方式仍然报“已损坏”，可以在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/Folia.app
```

如果你的应用不在 `Applications`，把路径改成实际位置，例如：

```bash
xattr -dr com.apple.quarantine ~/Downloads/Folia.app
```

执行后重新打开应用即可。

## 如果还是打不开

- 删除当前 `Folia.app` 和已下载的 `dmg`，重新从 Releases 下载
- 确认你运行的是拖拽后的 `Folia.app`，不是 dmg 里的临时挂载版本
- 在终端执行 `spctl --assess -vv /Applications/Folia.app` 查看 Gatekeeper 的当前判断结果

## 为什么现在会这样

目前发布流程会正常打出 macOS 安装包，但还没有接入 Apple 签名和 notarization。只要没有这一步，部分 macOS 版本就会把未签名应用直接提示为“已损坏”或“无法验证开发者”。

如果后续接入签名与 notarization，这个提示可以随之移除。
