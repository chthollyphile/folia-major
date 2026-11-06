# 猫与蜜蜂 · 留声 v0.4

蜜蜂继续按歌词节奏飞行，字生成后留在当次乐句的出生邻域，只作约1–3像素局部浮动。第N句完整保留至第N+2句开始出现，再用0.9秒渐隐；N+1出现不会挤走旧句。空白行不计数，末两句保留至切歌。没有固定全屏字幕槽，也不再按当前轨迹拖行或裁去旧尾部。

| lyricMode | 真正不同的放出形式 |
| --- | --- |
| auto | Agent按素材证据填入artStyle；本例line-art选择glyph，不是运行时图像识别 |
| glyph | 在预留的连贯字位上按各字/词时值原位描显，借鉴雾笺留下痕迹的节奏，没有笔顺库 |
| line | 完整句子共享一个入场，整体显现和轻浮；不是逐字推进窗口 |
| assemble | 各字词独立错位浮现，短距离聚成句子，再留在原处 |

字位在画幅/字体改变时一次编译。逐字模式按真实出生位置形成轻弯字簇，最多六个单元；源点跨度大时继续拆簇，为完整乐句预留空间，避免逐字避让挤成乱字堆。实际锚点距各自出生源不超过画幅短边22%，不要求与蜂的像素坐标重合。新字只显现，已经出现的字不搬动。预留包围盒涵盖入场、漂浮和三句交接。长文本/大字号会在生成前整体缩小以完整保留，不假称任意极长输入仍有大字阅读效果。

减少动态效果取消入场位移和漂浮，直接显示完整句，仍遵守N+2退场。翻译在独立区域显示。API2没有鼠标、准确音高或BPM，本例不是原壁纸交互脚本的复刻。

原素材：用户本地Wallpaper Engine 3444535389，制作署名SYKM；原画作者在项目描述中未确定。只使用本地转换的猫和蜂PNG，没有执行原脚本或搬入原音乐；素材不进入仓库和skill。

仓库中准备与打包：

```powershell
node style-packs/catBee/prepare.mjs <包含cat.png与cat_bee2.png的目录>
npm run style:pack -- style-packs/catBee <输出.folia-style.json>
node style-packs/catBee/bundle.mjs <输出.folia-style.json> <交付目录>
```

交付source已将共享模块放进source/lyricImprint，可直接用style:pack打包整个source目录。蜜蜂原贴图有效区为159×142内的(50,50,59,42)，其他素材须重新测量。

实现：flight.mjs保留自然飞行；trail/release接入共享引擎；lyricImprint/timeline决定三语法和N+2，anchors预留整句空间，motion求固定锚点的局部姿态，paint绘制。验证命令为npm run test:unit -- test/unit/stylePacks，实际浏览器、MCP、审查与视觉观察边界另见交付VERIFICATION.md。
