# librespot 运行时（Windows）

`resources/librespot/` 里的文件不入库，由 `packaging/librespot/fetch-librespot.mjs` 在开发机和构建机上准备：

```powershell
npm run librespot:fetch
```

## 为什么不在 git 里

`go-librespot.exe` 有 13.8MB，只有在我们上调 pin 的版本时才会变。这类第三方二进制一旦进 git，每个
clone 就永远要为它付一次带宽。这和 `models/`、`build/ffmpeg/` 是同一条规则，做法也一致：脚本下载
+ SHA-256 校验，哈希写死在脚本里，不匹配就拒绝使用。

## 里面有什么

| 文件 | 来源 | 许可证 |
| --- | --- | --- |
| `go-librespot.exe` | [devgianlu/go-librespot](https://github.com/devgianlu/go-librespot) 官方 `v0.10.3` Windows amd64 发布包（脚本下载并校验 SHA-256） | GPL-3.0 |
| `libogg-0.dll`、`libvorbis-0.dll`、`libvorbisenc-2.dll` | Xiph.Org 的 libogg / libvorbis，MinGW-w64 构建 | BSD-3-Clause |
| `libFLAC.dll` | Xiph.Org 的 FLAC，MinGW-w64 构建 | BSD-3-Clause |
| `libmpg123-0.dll` | mpg123，MinGW-w64 构建 | LGPL-2.1 |
| `libwinpthread-1.dll` | mingw-w64 运行时 | 见 mingw-w64 的 runtime 许可 |

Folia 自身是 AGPL-3.0，与 GPL-3.0 的 go-librespot 兼容；以二进制形式分发时按上表保留来源与许可声明。

## 与仓库规则的冲突点，以及这样处理的原因

规则是"第三方二进制不放进 git，改为 pin 住来源 + 校验哈希、构建期下载"，`go-librespot.exe` 满足这条：
GitHub Release 的资产地址是永久的，脚本里已经写死版本和 SHA-256。六个解码 DLL 不满足，原因有三条：

1. 上游的 Windows 发布包**只含 exe 和 README**，不含它动态链接的解码库。上游 README 的做法是让使用者
   自己装 MSYS2 的 `mingw-w64-x86_64-libogg`、`-libvorbis`、`-flac`、`-mpg123` 包。
2. 直接 pin MSYS2 的软件包文件不可靠：MSYS2 仓库只保留每个包的最新版本，旧文件会被删掉，pin 住的 URL
   早晚失效（这点和 GitHub Release 资产不同，那里删不掉）。
3. 改用 MSYS2 当前版本的 DLL，等于把作者已经人工验证过的运行时换成没验证过的一套，与"提交内容必须经过
   人工验证"相抵触。

因此脚本的形态是：从上游取 exe 并校验，然后检查那 6 个 DLL 是否就位；缺任何一个都直接报错并列出文件名，
而不是让打包出来的应用在用户机器上起不来。**Windows 打包必须先把这 6 个 DLL 放进 `resources/librespot/`**，
`build/beforePack.cjs` 会在 electron-builder 打包前自动执行这一步。

推荐的处理方式照 `folia-ffmpeg-build` 的先例：建一个只放运行时的 release（exe + 6 个 DLL，附来源与许可
声明），再把脚本的来源换成它。这属于维护者的基础设施决定，所以写在这里而不是自行决定。
