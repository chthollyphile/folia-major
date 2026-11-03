# 首页页面

Folium 提供 `folium.registries.homeTabs` 与 `folium.ui.openHomeTab(localId)`。入口追加到 Grid 与 Bravais 的首页导航；宿主提供完整页面容器和返回原生首页的导航。模组页面在自己的 ShadowRoot 中渲染，不需要访问宿主 DOM。

```js
const page = folium.registries.homeTabs.register({
  id: 'messages',
  label: { 'zh-CN': '消息', en: 'Messages' },
  order: 200,
  mount(container, ctx) {
    const input = document.createElement('textarea');
    container.append(input);
    return () => { /* 移除监听、释放页面资源 */ };
  },
});
folium.ui.openHomeTab('messages');
```

注册 ID 由宿主加上模组名字空间；`openHomeTab` 只接受该模组仍已注册的本地 ID，不允许打开其他模组的页面，传入未注册的 ID 会抛出 `home-tab-not-registered:<id>`。`openHomeTab` 会先切回首页再打开页面。`order` 默认 500，只决定附加入口之间的排序（相同时按 ID）；原生页签顺序保持原样。TUI 首页的导航里没有入口，但 `openHomeTab` 打开的页面同样会盖在 TUI 首页上。

## 页面容器

容器有确定宽高；页面内容应使用 `min-width: 0` / `min-height: 0` 和适当的内部滚动布局。宿主为容器提供 `--folium-*` 主题变量，`ctx.getTheme()` / `ctx.onChange()` 与播放器面板页签相同。语言变化会以新 `ctx.locale` 重新挂载。

页面顶部是宿主的页头：返回按钮、原生页签和各模组页面的页签。页面整体下移 32px，让出自绘标题栏的拖拽区，页头整块都可以点。页头里点原生页签与在首页里点它效果相同（例如 Bravais 会收起缝里的搜索框）；该页签不可用时什么都不做，页面留着。

选中页面时原生首页保持挂载并停止交互，因此返回时其资源和页签状态仍在。页面画在首页的集合层、目录图之上，集合开着时用 `openHomeTab` 打开的页面也不会被它们盖住；登录弹窗仍在页面之上。反过来，页面开着时主动打开集合（搜索结果、播放页面板里点专辑或歌手等）会先关闭页面，让集合显示出来；浏览器前进后退恢复的集合不会关闭页面。注册表不管理账号：模组应按自己的账号或来源状态注册和注销入口。

## 键盘与焦点

- **全局快捷键让路**：页面开着时，页面里的按键由模组处理，不触发宿主的直接输入搜索、页签切换等全局快捷键。只有 Ctrl+K（macOS 为 Cmd+K，不带 Shift、Alt）放行，用来打开宿主命令面板，从模组 ShadowRoot 里的输入框按也一样。Bravais 下的 F6 / Shift+F6 另由宿主接着切换首页页签，见下文。
- **打开时**：焦点交给页头里这个页面自己的页签，再按 Tab 进入页面控件。设置、命令面板等接管键盘的窗口开着时不抢它们的焦点（页面这时开在它们下面）：等窗口关掉、焦点空出来再交给页签。例如在设置的模组面板里运行打开页面的命令，Esc 仍然关闭设置，关掉之后焦点落在页面的页签上。
- **页内 Tab 循环**：页内的 Tab 顺序交给浏览器。Tab 越过页面最后一个控件时回到页头的返回按钮，在返回按钮上按 Shift+Tab 回到页面最后一个控件。找首尾控件时穿透模组的 open ShadowRoot 和 slot 投影；closed ShadowRoot 和 iframe 里的控件找不到，这时焦点落在离那一头最近、能找到的控件上。模组自己 `preventDefault` 的 Tab 不会移动焦点，宿主也不接管。
- **关闭时**：焦点还给打开页面时拿着焦点的元素（例如 Grid 导航里的入口按钮），在几个模组页面之间切换不会改变这个元素。只在焦点随页面消失、或仍在页面里时才还，不抢命令面板等上层窗口的焦点。
- **Grid**：首页的 Tab / Shift+Tab 在原生页签与模组入口之间循环（输入框里的 Tab 不抢），切到模组入口即打开页面。
- **Bravais**：模组页签排在缝里的原生页签后面。页面开着时只有它是选中状态，原生页签的 `aria-selected` 都为 false；F6 / Shift+F6 把模组页签和原生页签排在一起循环，跳过不可用的页签，切到模组页签即打开页面。

页面开着时按键归页面，Grid 的 Tab 不再切换首页页签；Bravais 的 F6 / Shift+F6 例外：在页面里（模组的输入框之外）按时从这个页面的页签接着循环，切到下一个模组页面，或绕回原生页签并关闭页面；模组自己 `preventDefault` 的 F6 宿主不接。用页头里的页签或返回按钮回到原生首页，在命令面板里选原生首页页签也会关闭页面（首页藏在播放页下、或者在 Lattice 里选也一样）。

## 生命周期

离开页面或首页时执行 mount 返回的清理函数。首页整个藏起（例如切到播放页）时页面也会卸载；回到首页时页面仍是打开的，会重新挂载。注销显示中的入口或禁用模组会立即返回原生首页。重新注册同一个 ID 不受旧注销句柄影响。UI 注册在导出窗口中为空操作，`openHomeTab` 在导出窗口中抛出 `ui-unavailable-in-export-context`。

## 样例

- [sample-home-tab](../../dev/folium/sample-home-tab/README.md)：离线验证页面容器、输入隔离、挂载清理和注销入口，不需要真实账号。
- [sample-playback-console](../../dev/folium/sample-playback-console/README.md)：在页面里调音量、循环模式并分页点播播放队列，演示播放控制接口。

两个样例都没有签名，也不在开发版自动扫描的 `mods/` 目录里，安装方法见各自的 README。
