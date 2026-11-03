## 下载说明

> [!TIP]
> 如果国内网络从 GitHub Releases 下载较慢，可以使用 [夸克网盘](https://pan.quark.cn/s/6e4c6fa3bc6f) 或 [百度云](https://pan.baidu.com/s/1f0x3g-8PMcNCO-TJ5z1rPw?pwd=flia) 下载。网盘链接仅提供 Windows 与 Apple silicon 的正式版安装包

- Windows：下载 `Folia-Setup-<version>.exe`
- macOS：
  - Apple Silicon：下载 `Folia-<version>-arm64.dmg`
  - Intel Mac：下载 `Folia-<version>-x64.dmg`
  - 如果打开时提示“应用已损坏”，这通常是当前 macOS 包未签名 / 未 notarize 导致的 Gatekeeper 拦截，不是安装包本身损坏。解决方法见[这份说明]({{MACOS_UNSIGNED_HELP_URL}})

如果国内网络从 GitHub Releases 下载较慢，可以使用 [夸克网盘](https://pan.quark.cn/s/6e4c6fa3bc6f) 或 [百度云](https://pan.baidu.com/s/1f0x3g-8PMcNCO-TJ5z1rPw?pwd=flia) 下载。网盘链接仅提供 Windows 与 Apple silicon 的正式版安装包

- Linux：
  - Arch Linux / Manjaro：通过 AUR 安装 `yay -S folia-major-bin`
  - Debian / Ubuntu：下载 `folia-major-<version>-linux-amd64.deb`
  - Fedora / openSUSE：下载 `folia-major-<version>-linux-x86_64.rpm`
  - 其他发行版：下载 `folia-major-<version>-linux-x64.tar.gz`
  - ARM64（树莓派等 aarch64 设备）：按发行版下载 `folia-major-<version>-linux-arm64.deb` / `folia-major-<version>-linux-aarch64.rpm` / `folia-major-<version>-linux-arm64.tar.gz`

## 更新说明

- 初步接入 QQ 音乐 provider，目前提供基础的账号登录、在线搜索与播放能力，支持的功能仍较少，后续版本将继续完善。
- 新增音频均衡器，可在播放控制面板中调节并保存声音设置。
- 新增桌面歌词 API，方便外部应用读取当前播放歌曲和同步歌词。
- 支持为本地单曲导入、显示并持久化自定义封面。
- Sonnet 可视化现已接入全局字重设置，并包含依赖更新与稳定性修复。

_那些永恒的价值，正存在于这些无法复制的事物中_
