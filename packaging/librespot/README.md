# librespot 运行时（Windows）

`resources/librespot/` 里的文件不入库，由 `packaging/librespot/build-librespot-static.mjs` 在开发机和
构建机上从 pin 住的来源编出来：

```powershell
npm run librespot:build     # 编静态版，需要 MSYS2（见下）
npm run librespot:verify    # 只校验；build/beforePack.cjs 在打包前走的也是这条校验
```

## 为什么不在 git 里

`go-librespot.exe` 有 13MB 上下，只有在我们上调 pin 的版本时才会变。这类第三方二进制一旦进 git，每个
clone 就永远要为它付一次带宽。这和 `models/`、`build/ffmpeg/` 是同一条规则：来源写死在脚本里
（tag 与 commit 都在 `packaging/librespot/fetch-librespot.mjs`），产物哈希写进 `BUNDLE-INFO.txt`，
对不上就拒绝打包。

## 为什么改成静态链接

上游的 Windows 发布包是**动态链接**的：运行需要 `libFLAC.dll`、`libmpg123-0.dll`、`libogg-0.dll`、
`libvorbis-0.dll`、`libvorbisenc-2.dll`、`libwinpthread-1.dll` 这六个 MinGW 库，而发布包里一个都不带。
这六个库在上游没有可 pin 的分发渠道（MSYS2 仓库只保留每个包的最新版本，旧文件会被删掉），照搬上游产物
就等于要求每台构建机自己凑齐它们，打包出来的应用也仍然依赖一堆 DLL。

改成静态链接后 `resources/librespot/` 里只有一个 exe，运行时不依赖任何第三方 DLL：

- 工具链与包路径和上游 `release.yml` 的 windows 作业一致：MSYS2 MINGW64 下的
  `mingw-w64-x86_64-{gcc,pkg-config,libogg,libvorbis,flac,mpg123}`，构建 `./cmd/daemon`；
- 只多一个 `-ldflags "-s -w -linkmode external -extldflags -static"`，静态库就来自上面那几个包；
- 按 [CROSS_COMPILE.md](https://github.com/devgianlu/go-librespot/blob/master/CROSS_COMPILE.md)，用 vcpkg 的
  `x64-mingw-static` triplet 从 Linux 交叉编译也能得到同样的静态产物。

## 里面有什么

| 文件 | 来源 | 许可证 |
| --- | --- | --- |
| `go-librespot.exe` | [devgianlu/go-librespot](https://github.com/devgianlu/go-librespot) `v0.10.3`（commit `4dbc099f46da3529adaa85feb97c4f49deb0b130`）静态链接构建 | GPL-3.0 |

Folia 自身是 AGPL-3.0，与 GPL-3.0 的 go-librespot 兼容；以二进制形式分发时按上表保留来源与许可声明。

## 本地准备（Windows）

```powershell
winget install MSYS2.MSYS2        # 装完重开终端；装在别处就设 MSYS2_ROOT
npm run librespot:build
```

脚本会自己 `pacman -S` 装上表那几个包、把源码按 pin 住的 commit 检出到临时目录、编译，再把产物和哈希写进
`resources/librespot/`。产物不入库，所以每台构建机（含 CI）在打包前都要跑一次；`npm run librespot:verify`
会检查 exe 在不在、是不是静态链接、哈希和 `BUNDLE-INFO.txt` 是否一致。

只有 Windows 打包需要它：`main.cjs` 也只在 win32 启动守护进程，其余平台这一步直接跳过。
