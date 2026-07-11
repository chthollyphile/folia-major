<p align="center">
  <img src="/img/head2.png" alt="Folia" width="100%" />
</p>

<div align="center">
<a href="https://trendshift.io/repositories/71740?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-71740" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/71740" alt="chthollyphile%2Ffolia-major | Trendshift" width="250" height="55"/></a>

# Folia

Lyrics Reimagined // 辞曲新境

[![GitHub release](https://img.shields.io/github/v/release/chthollyphile/folia-major?label=release)](https://github.com/chthollyphile/folia-major/releases)
[![License](https://img.shields.io/github/license/chthollyphile/folia-major)](https://github.com/chthollyphile/folia-major/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/chthollyphile/folia-major?style=social)](https://github.com/chthollyphile/folia-major/stargazers)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
[![All Contributors](https://img.shields.io/badge/all_contributors-26-orange.svg?style=flat-square)](#contributors-)
<!-- ALL-CONTRIBUTORS-BADGE:END -->

[桌面版下载](https://github.com/chthollyphile/folia-major/releases)
·
[Vercel 部署](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major)
·
[使用指南](https://folia-site.vercel.app/guide/)
·
[技术说明](docs/technical.md)

</div>

## 项目简介

Folia是一个以全屏沉浸式歌词播放为核心的在线音乐播放器，支持网易云，navidrome和本地音乐库，通过智能歌词匹配，AI生成配色主题，以及多种全屏歌词动画为用户提供独特的听歌体验。

如果你希望直接开箱即用，马上体验，推荐直接使用基于Electron的 windows/ macOS/ Linux 桌面端版本。

如果希望能够在移动设备上使用，或在浏览器上体验云端多平台，可以选择[一键部署到 Vercel](https://folia-site.vercel.app/guide/deploy-vercel) 的 Web 版本，或自行部署到其他支持 Node.js 的平台。

## 展示

### 演示视频

https://github.com/user-attachments/assets/fd27f4f0-64b9-4c57-8c3b-10df767f934b

https://github.com/user-attachments/assets/704f195a-2194-434b-86e8-8f36290e5cc4

### 主题预览

<table>
  <tr>
    <td width="50%">
      <img src="./img/preview-fume.png" alt="Fume 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-lumi.png" alt="Lumi 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>浮名</strong></td>
    <td align="center"><strong>流光</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cad.png" alt="Cad 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-pat.png" alt="Pat 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>心象</strong></td>
    <td align="center"><strong>云阶</strong></td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./img/preview-cappella.jpg" alt="群唱 主题预览" />
    </td>
    <td width="50%">
      <img src="./img/preview-tilt.png" alt="Tilt 主题预览" />
    </td>
  </tr>
  <tr>
    <td align="center"><strong>群唱</strong></td>
    <td align="center"><strong>倾诉</strong></td>
  </tr>
</table>

不同的歌词动画具有不同的排版氛围和可调参数，让全屏歌词拥有如同文字PV般的丰富视觉效果，同时又能兼顾响应式布局，自动适配不同窗口尺寸。

## 核心能力

| 模块 | 说明 |
| --- | --- |
| 在线搜索与播放 | 搜索歌曲、歌手或专辑后即可播放，并自动加载相关封面与歌词。 |
| 本地音乐支持 | 可导入本地音频文件，在本地安全保存索引信息，不上传文件内容。 |
| 智能歌词匹配 | 本地歌曲可自动匹配在线歌词与封面，也支持手动修正匹配结果。 |
| 本地歌词文件识别 | 自动加载同目录同名 `.lrc`、`.vtt`、`.ttml`、`.qrc`、`.yrc`、`.krc` 歌词文件，或歌词文件内嵌 LRC 歌词。适配 LDDC 生成的增强型逐字歌词格式。 |
| Now Playing 接入 | 支持通过本机 [Now Playing](https://github.com/Widdit/now-playing-service/) 服务接入外部播放器的歌曲、时间轴与歌词信息，并驱动 Folia 的舞台视图与全屏歌词渲染。 |
| AI 主题生成 | 基于歌曲情绪与歌词内容生成沉浸式背景与视觉参数。 |
| 多端体验 | 提供 Web 部署方式，同时支持桌面端打包分发。 |

## 获取方式

桌面版内置前后端运行环境，适合希望即装即用的用户。

- **Windows / macOS / Linux**: 最新版本的安装包请前往 [Releases 页面](https://github.com/chthollyphile/folia-major/releases) 下载。
- **Arch Linux**: 可通过 AUR 获取 [folia-major-bin](https://aur.archlinux.org/packages/folia-major-bin)。
- **Flatpak**: 社区提供的第三方 flatpak，详情见 [Flatpark](https://flatpark.org/apps/top.izuna.foliamajor/)。

Linux 包、Wayland / Hyprland 遥控窗和桌面端细节见 [技术与开发说明](docs/technical.md)。

## 文档与开发

更完整的使用说明请访问 [Folia Guide](https://folia-site.vercel.app/guide/)。

部署、环境变量、本地开发、Stage API、常用脚本和技术栈见 [技术与开发说明](docs/technical.md)。

如果你希望快速上线 Web 版本，请阅读 [Vercel 一键部署指南](https://folia-site.vercel.app/guide/deploy-vercel) 来创建项目

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/chthollyphile/folia-major)

## 本地音乐与匹配说明

使用本地音乐时，Folia 会优先尝试从以下来源补全信息：

1. 音频文件自身元数据
2. 同目录同名歌词文件
3. 在线匹配结果

如果自动匹配不准确，可以在播放界面的右侧面板进入“本地”选项卡，手动搜索并指定更合适的歌词、封面或元数据来源。你也可以选择只使用本地信息，关闭在线匹配结果。


## 贡献者

Thanks goes to these wonderful people. Issue reports, bug reports, ideas, docs, design, tests, and code are all counted through the [all-contributors](https://allcontributors.org/) spec.

<!-- ALL-CONTRIBUTORS-LIST:START -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/chthollyphile"><img src="https://avatars.githubusercontent.com/u/30263107?v=4?s=100" width="100px;" alt="冬霧"/><br /><sub><b>冬霧</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/commits?author=chthollyphile" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ZhaoAlpha931206"><img src="https://avatars.githubusercontent.com/u/113200713?v=4?s=100" width="100px;" alt="zhao_alpha"/><br /><sub><b>zhao_alpha</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3AZhaoAlpha931206" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/hz1ang"><img src="https://avatars.githubusercontent.com/u/79741472?v=4?s=100" width="100px;" alt="hz1ang"/><br /><sub><b>hz1ang</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Ahz1ang" title="Bug reports">🐛</a> <a href="#ideas-hz1ang" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/steadyoak"><img src="https://avatars.githubusercontent.com/u/62462010?v=4?s=100" width="100px;" alt="steadyoak"/><br /><sub><b>steadyoak</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Asteadyoak" title="Bug reports">🐛</a> <a href="#ideas-steadyoak" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/jin6yang"><img src="https://avatars.githubusercontent.com/u/68692517?v=4?s=100" width="100px;" alt="POINTER"/><br /><sub><b>POINTER</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Ajin6yang" title="Bug reports">🐛</a> <a href="#ideas-jin6yang" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Yuki-3939"><img src="https://avatars.githubusercontent.com/u/171513605?v=4?s=100" width="100px;" alt="Yuki-3939"/><br /><sub><b>Yuki-3939</b></sub></a><br /><a href="#ideas-Yuki-3939" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/MewsCat-Dev"><img src="https://avatars.githubusercontent.com/u/207451147?v=4?s=100" width="100px;" alt="MewsCat"/><br /><sub><b>MewsCat</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3AMewsCat-Dev" title="Bug reports">🐛</a> <a href="#ideas-MewsCat-Dev" title="Ideas, Planning, & Feedback">🤔</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://afdian.com/a/tumuyan"><img src="https://avatars.githubusercontent.com/u/3126801?v=4?s=100" width="100px;" alt="tumuyan"/><br /><sub><b>tumuyan</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Atumuyan" title="Bug reports">🐛</a> <a href="#ideas-tumuyan" title="Ideas, Planning, & Feedback">🤔</a> <a href="https://github.com/chthollyphile/folia-major/commits?author=tumuyan" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/948720857"><img src="https://avatars.githubusercontent.com/u/23718388?v=4?s=100" width="100px;" alt="948720857"/><br /><sub><b>948720857</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3A948720857" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/setube"><img src="https://avatars.githubusercontent.com/u/73606411?v=4?s=100" width="100px;" alt="谦君"/><br /><sub><b>谦君</b></sub></a><br /><a href="#ideas-setube" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/suheandzl"><img src="https://avatars.githubusercontent.com/u/3975134?v=4?s=100" width="100px;" alt="suheandzl"/><br /><sub><b>suheandzl</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Asuheandzl" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Enkianssus"><img src="https://avatars.githubusercontent.com/u/69905090?v=4?s=100" width="100px;" alt="Enkianssus"/><br /><sub><b>Enkianssus</b></sub></a><br /><a href="#ideas-Enkianssus" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/pwupink"><img src="https://avatars.githubusercontent.com/u/122716454?v=4?s=100" width="100px;" alt="不会飞的麻将"/><br /><sub><b>不会飞的麻将</b></sub></a><br /><a href="#ideas-pwupink" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/streamstack-cn"><img src="https://avatars.githubusercontent.com/u/270505056?v=4?s=100" width="100px;" alt="streamstack-cn"/><br /><sub><b>streamstack-cn</b></sub></a><br /><a href="#ideas-streamstack-cn" title="Ideas, Planning, & Feedback">🤔</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/bywhite0"><img src="https://avatars.githubusercontent.com/u/86943191?v=4?s=100" width="100px;" alt="白影White"/><br /><sub><b>白影White</b></sub></a><br /><a href="#ideas-bywhite0" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/IXnAh1L"><img src="https://avatars.githubusercontent.com/u/298766825?v=4?s=100" width="100px;" alt="IXnAh1L"/><br /><sub><b>IXnAh1L</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3AIXnAh1L" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://chatwise.app"><img src="https://avatars.githubusercontent.com/u/8784712?v=4?s=100" width="100px;" alt="EGOIST"/><br /><sub><b>EGOIST</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Aegoist" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="http://www.yanfd.cn"><img src="https://avatars.githubusercontent.com/u/70418161?v=4?s=100" width="100px;" alt="yanfd"/><br /><sub><b>yanfd</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Ayanfd" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://tonysmith.vercel.app/"><img src="https://avatars.githubusercontent.com/u/108202013?v=4?s=100" width="100px;" alt="Tony Smith"/><br /><sub><b>Tony Smith</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/commits?author=tonysmith1sme" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/z962432526-commits"><img src="https://avatars.githubusercontent.com/u/299800478?v=4?s=100" width="100px;" alt="z962432526-commits"/><br /><sub><b>z962432526-commits</b></sub></a><br /><a href="#ideas-z962432526-commits" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/AndyRose806"><img src="https://avatars.githubusercontent.com/u/74594311?v=4?s=100" width="100px;" alt="AndyRose806"/><br /><sub><b>AndyRose806</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3AAndyRose806" title="Bug reports">🐛</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://bit.ly/howlingFounts"><img src="https://avatars.githubusercontent.com/u/43498546?v=4?s=100" width="100px;" alt="嗷呜风字"/><br /><sub><b>嗷呜风字</b></sub></a><br /><a href="#ideas-howlingFounts" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Jirankun"><img src="https://avatars.githubusercontent.com/u/174584819?v=4?s=100" width="100px;" alt="Zhyllan Fyllah"/><br /><sub><b>Zhyllan Fyllah</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/commits?author=Jirankun" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/ROYI-Jiang"><img src="https://avatars.githubusercontent.com/u/124415415?v=4?s=100" width="100px;" alt="ROYI-Jiang"/><br /><sub><b>ROYI-Jiang</b></sub></a><br /><a href="#ideas-ROYI-Jiang" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/lhtstudy"><img src="https://avatars.githubusercontent.com/u/91039875?v=4?s=100" width="100px;" alt="LHT"/><br /><sub><b>LHT</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/issues?q=author%3Alhtstudy" title="Bug reports">🐛</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/SXP-Simon"><img src="https://avatars.githubusercontent.com/u/177809507?v=4?s=100" width="100px;" alt="Helian Nuits"/><br /><sub><b>Helian Nuits</b></sub></a><br /><a href="https://github.com/chthollyphile/folia-major/commits?author=SXP-Simon" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

<!-- 添加 issue 提出者时可以使用：

```bash
npm run contributors:add -- github-username bug
npm run contributors:add -- github-username bug,ideas
npm run contributors:generate
``` -->

## 法律与免责声明

本项目在 AI 的广泛协助下开发，因此仍可能存在细微或不易察觉的问题。若给你带来不便，敬请理解。

本项目主要用于展示播放动效、界面设计与相关工程实现。应用中涉及的在线音乐流媒体、歌词、专辑封面及其他内容，其版权均归对应权利人所有。

本仓库及其源代码仅供个人学习、技术交流与非营利测试使用。请勿将其用于商业盈利用途。若因对在线资源的传播、加工或再分发而引发版权纠纷或其他责任，均由使用者自行承担，项目开发者不承担相关责任。

请始终尊重数字版权，并在条件允许时通过官方平台支持正版音乐。

## 致谢

特别感谢以下项目和资源：

- [chenmozhijin/LDDC](https://github.com/chenmozhijin/LDDC)
- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- [chenglou/pretext](https://github.com/chenglou/pretext)

本项目接入了 [Apple Music-like Lyrics TTML 逐词歌词库](https://github.com/amll-dev/amll-ttml-db) 以提供高质量的歌词文件，感谢此歌词库的作者和贡献者们。

## 许可证

本项目基于 `AGPL-3.0` 许可证开源。
