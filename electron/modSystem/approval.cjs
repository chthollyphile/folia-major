// electron/modSystem/approval.cjs
// Whether a mod may run. The user's approval of a mod is stored together with
// the digest of the files it was given for, and holds only while the files are
// those; the native dialog that asks for it, with its text in the four
// languages, is here too. Cut out of modSystem.cjs. How a digest and a
// signature are computed stays in modDigest.cjs and modSignature.cjs.

'use strict';

const path = require('path');
// original-fs: a mod folder is read as files, as the digest reads it (rawFs.cjs).
const { rawFs: fs } = require('./rawFs.cjs');
const { resolveModNativeFile } = require('./nativeFiles.cjs');
const { dialog } = require('electron');

const { shortDigest } = require('./modDigest.cjs');

// Native confirmation dialog copy. The main process cannot reach the renderer's
// i18n bundle, so the four shipped locales are mirrored here like main.cjs's
// own dialog strings.
const TRUST_DIALOG_LOCALE = {
    'zh-CN': {
        title: '启用模组',
        message: (name, id) => `确定要启用模组“${name}”（${id}）吗？`,
        risk: '模组是第三方代码。启用后它以应用的完整权限运行，能读写文件、访问网络、改动任意设置。只启用你信任来源的模组。',
        permissions: '声明的权限：',
        noPermissions: '声明的权限：无',
        platformRead: (platforms) => `以你的账号读取平台数据（实验接口 platform.raw）：${platforms}。模组会以你在 Folia 登录的账号读取这些平台上的数据，例如听歌记录。`,
        platformWrite: (platforms) => `以你的账号改动平台数据：${platforms}。模组还可以改动这些平台账号里的内容，例如点赞、歌单和关注。`,
        queueReplace: '替换播放队列（playback.queue）：模组可以一次换掉整个播放队列，并结束私人 FM。替换后 Folia 会提示是哪个模组换的；在队列再被改动之前，可以撤销回替换前的队列。',
        equalizerControl: '会改写你的音效设置（equalizer.control）：模组可以切换你的音效预设，或换上它自己的均衡器曲线。你的自定义音效不会被覆盖，在音频效果器里随时可以换回。',
        renderQuality: '会改写歌词画布的渲染质量（visualizer.renderQuality）：模组可以修改「动画与性能」里的歌词画布分辨率与抗锯齿，用 canvas / WebGL 画的歌词样式会跟着变。各样式自己单独指定的设置不受影响，在「动画与性能」里随时可以改回。',
        visualizerMode: '会切换你的歌词动画样式（visualizer.mode）：模组可以替你换歌词样式，和你在播放页切换一样（「每首歌随机歌词动画」也会随之关掉）。在播放页随时可以换回。',
        visualizerTuning: '会改写歌词样式的设置（visualizer.tuning）：模组可以修改内置歌词样式自己的选项，例如镜头、动效和装饰。分辨率等画质设置不受影响，在样式设置里随时可以改回。',
        visualizerBeatEffects: '会改写智能动感模式的动感效果（visualizer.beatEffects）：模组可以开关各歌词样式的动感效果、调整强度。智能动感模式本身（关闭 / 只用已分析 / 开启）始终由你决定；但在「开启」下，模组打开的效果会让 GPU 为没分析过的歌做相应的分析（按鼓点的效果要分离鼓声）。',
        visualizerBackground: '会切换你的背景（visualizer.background）：模组可以替你换播放页的背景，和你在背景选择器里切换一样。各背景自己的图片和选项不受影响，在播放页随时可以换回。',
        visualizerAnimationIntensity: '会改写动画强度（visualizer.animationIntensity）：模组可以替你调整歌词和背景动画的强度，和你在播放页面板里调整一样。随时可以改回。',
        themeWrite: '会把模组自己的主题盖在歌曲主题上（theme.write）：模组可以换掉播放页的配色，不会改动你存下的主题。你一选主题就会撤下，在播放页面板里也可以随时撤下。',
        location: '安装位置：',
        fingerprint: '内容指纹：',
        client: '界面代码：',
        noClient: '界面代码：无',
        experimental: '选用的实验接口：',
        embedOrigins: '可嵌入的外部网页：',
        folia: '需要的 Folia 版本：',
        verifiedRisk: '这个模组带有效的 Folium 官方签名：经过官方审查，签名后没有改动。启用后它仍以应用的完整权限运行。',
        signatureVerified: (key) => `签名：官方认证（${key}）`,
        betaRisk: '这是先行测试版：只通过了安全审查，功能可能不完整甚至无法工作。启用后它以应用的完整权限运行。',
        signatureBeta: (key) => `签名：先行测试（${key}）`,
        signatureUnsigned: '签名：无（未经官方审查的第三方模组）',
        signatureInvalid: (reason) => `签名：不匹配（${reason}）。模组内容在签名后被修改，或签名无效，这份签名不能作为审查依据。`,
        rebind: '本次确认仅对当前文件内容生效；模组文件发生变化后需要重新确认。',
        devSource: '开发模式：这个模组位于源码目录的 mods/ 中，确认后修改它的文件不会撤销本次确认。安装版和用户模组目录中的模组没有这项豁免。',
        sourceIntro: (sources) => `这个模组提供音源：${sources}。它会保管你在这些平台的登录，不受模组的网络和存储限额约束，并随应用一起启动。`,
        takeover: (ids) => `它会接管这个安装没有带的音源：${ids}，并用上你在这些平台已有的登录（队列、历史、歌单里这些平台的歌也接着用）。`,
        takeoverData: (items) => `它要接的旧数据：${items}`,
        takeoverNative: (names) => `它带着自己的原生程序，会直接在你的电脑上运行（不是应用带的那份）：${names}`,
        certificateExceptions: (hosts) => `对这些域名放宽证书检查：${hosts}`,
        lyricRelayHosts: (hosts) => `经应用中转歌词请求的域名：${hosts}`,
        selfSignedUserServers: (sources) => `连接你自己填写的服务器（例如家里的 NAS）时接受它的自签证书：${sources}`,
        overrideTitle: '用新版本替换内置模组',
        overrideMessage: (name, id, version, builtinVersion) => `用 ${version} 版替换内置的“${name}”（${id}，${builtinVersion} 版）吗？`,
        overrideDetail: '这个副本带有有效的 Folium 官方签名，版本高于随应用安装的内置副本。确认后它替代内置副本运行，沿用内置副本的登录和数据；删掉它就回到内置副本。启用后它仍以应用的完整权限运行。',
        overrideConfirm: '替换',
        clearTitle: '清除音源数据',
        clearMessage: (id) => `清除音源“${id}”的数据吗？`,
        clearDetail: '它会登出，并删掉下面这些。删掉的找不回来；停用音源不会删这些。',
        clearConfirm: '清除',
        enable: '仍要启用',
        communityTitle: '打开社区模组',
        communityMessage: '允许安装和运行社区模组吗？',
        communityDetail: '社区模组是第三方代码，没有 Folia 的官方签名，可能也没有经过安全审查。打开后可以从 zip 或模组市场安装任何模组；之前确认过的模组会立刻运行，其余每个模组启用前仍会单独确认。启用的模组以应用的完整权限运行。',
        communityConfirm: '打开',
        rangeTitle: '尝试加载版本声明已过期的模组',
        rangeMessage: (name, id) => `仍要尝试加载“${name}”（${id}）吗？`,
        rangeBatchMessage: (count) => `仍要尝试加载这 ${count} 个版本声明已过期的模组吗？`,
        rangeDetail: (range, version) => `作者声明它只支持 Folia ${range}，当前是 ${version}。它多半还能用，但可能出错或功能不全；出了问题请向模组作者反馈，不要反馈到 Folia。模组更新后要重新确认。`,
        rangeFeedback: (url) => `反馈地址：${url}`,
        rangeConfirm: '尝试加载',
        uninstallTitle: '卸载模组',
        uninstallMessage: (name, id) => `卸载模组“${name}”（${id}）吗？`,
        uninstallDetail: '模组文件夹会移到回收站，它存下的数据保留。',
        uninstallOverride: '卸载后回到随应用安装的内置版本。',
        uninstallConfirm: '卸载',
        cancel: '取消',
    },
    'zh-TW': {
        title: '啟用模組',
        message: (name, id) => `確定要啟用模組“${name}”（${id}）嗎？`,
        risk: '模組是第三方程式碼。啟用後它以應用的完整權限執行，能讀寫檔案、存取網路、改動任意設定。只啟用你信任來源的模組。',
        permissions: '宣告的權限：',
        noPermissions: '宣告的權限：無',
        platformRead: (platforms) => `以你的帳號讀取平臺數據（實驗介面 platform.raw）：${platforms}。模組會以你在 Folia 登入的帳號讀取這些平臺上的資料，例如聽歌記錄。`,
        platformWrite: (platforms) => `以你的帳號改動平臺數據：${platforms}。模組還可以改動這些平臺帳號裡的內容，例如點贊、歌單和關注。`,
        queueReplace: '替換播放佇列（playback.queue）：模組可以一次換掉整個播放佇列，並結束私人 FM。替換後 Folia 會提示是哪個模組換的；在佇列再被改動之前，可以撤銷回替換前的佇列。',
        equalizerControl: '會改寫你的音效設定（equalizer.control）：模組可以切換你的音效預設，或換上它自己的等化器曲線。你的自定義音效不會被覆蓋，在音訊效果器裡隨時可以換回。',
        renderQuality: '會改寫歌詞畫布的渲染質量（visualizer.renderQuality）：模組可以修改「動畫與效能」裡的歌詞畫布解析度與抗鋸齒，用 canvas / WebGL 畫的歌詞樣式會跟著變。各樣式自己單獨指定的設定不受影響，在「動畫與效能」裡隨時可以改回。',
        visualizerMode: '會切換你的歌詞動畫樣式（visualizer.mode）：模組可以替你換歌詞樣式，和你在播放頁切換一樣（「每首歌隨機歌詞動畫」也會隨之關掉）。在播放頁隨時可以換回。',
        visualizerTuning: '會改寫歌詞樣式的設定（visualizer.tuning）：模組可以修改內建歌詞樣式自己的選項，例如鏡頭、動效和裝飾。解析度等畫質設定不受影響，在樣式設定裡隨時可以改回。',
        visualizerBeatEffects: '會改寫智慧動感模式的動感效果（visualizer.beatEffects）：模組可以開關各歌詞樣式的動感效果、調整強度。智慧動感模式本身（關閉 / 只用已分析 / 開啟）始終由你決定；但在「開啟」下，模組開啟的效果會讓 GPU 為沒分析過的歌做相應的分析（按鼓點的效果要分離鼓聲）。',
        visualizerBackground: '會切換你的背景（visualizer.background）：模組可以替你換播放頁的背景，和你在背景選擇器裡切換一樣。各背景自己的圖片和選項不受影響，在播放頁隨時可以換回。',
        visualizerAnimationIntensity: '會改寫動畫強度（visualizer.animationIntensity）：模組可以替你調整歌詞和背景動畫的強度，和你在播放頁面板裡調整一樣。隨時可以改回。',
        themeWrite: '會把模組自己的主題蓋在歌曲主題上（theme.write）：模組可以換掉播放頁的配色，不會改動你存下的主題。你一選主題就會撤下，在播放頁面板裡也可以隨時撤下。',
        location: '安裝位置：',
        fingerprint: '內容指紋：',
        client: '介面程式碼：',
        noClient: '介面程式碼：無',
        experimental: '選用的實驗介面：',
        embedOrigins: '可嵌入的外部網頁：',
        folia: '需要的 Folia 版本：',
        verifiedRisk: '這個模組帶有效的 Folium 官方簽名：經過官方審查，簽名後沒有改動。啟用後它仍以應用的完整權限執行。',
        signatureVerified: (key) => `簽名：官方認證（${key}）`,
        betaRisk: '這是先行測試版：只通過了安全審查，功能可能不完整甚至無法工作。啟用後它以應用的完整權限執行。',
        signatureBeta: (key) => `簽名：先行測試（${key}）`,
        signatureUnsigned: '簽名：無（未經官方審查的第三方模組）',
        signatureInvalid: (reason) => `簽名：不匹配（${reason}）。模組內容在簽名後被修改，或簽名無效，這份簽名不能作為審查依據。`,
        rebind: '本次確認僅對當前檔案內容生效；模組檔案發生變化後需要重新確認。',
        devSource: '開發模式：這個模組位於原始碼目錄的 mods/ 中，確認後修改它的檔案不會撤銷本次確認。安裝版和使用者模組目錄中的模組沒有這項豁免。',
        sourceIntro: (sources) => `這個模組提供音源：${sources}。它會保管你在這些平臺的登入，不受模組的網路和儲存限額約束，並隨應用一起啟動。`,
        takeover: (ids) => `它會接管這個安裝沒有帶的音源：${ids}，並用上你在這些平臺已有的登入（佇列、歷史、歌單裡這些平臺的歌也接著用）。`,
        takeoverData: (items) => `它要接的舊資料：${items}`,
        takeoverNative: (names) => `它帶著自己的原生程式，會直接在你的電腦上執行（不是應用帶的那份）：${names}`,
        certificateExceptions: (hosts) => `對這些網域放寬證書檢查：${hosts}`,
        lyricRelayHosts: (hosts) => `經應用中轉歌詞請求的網域：${hosts}`,
        selfSignedUserServers: (sources) => `連線你自己填寫的伺服器（例如家裡的 NAS）時接受它的自簽證書：${sources}`,
        overrideTitle: '用新版本替換內建模組',
        overrideMessage: (name, id, version, builtinVersion) => `用 ${version} 版替換內建的“${name}”（${id}，${builtinVersion} 版）嗎？`,
        overrideDetail: '這個副本帶有有效的 Folium 官方簽名，版本高於隨應用安裝的內建副本。確認後它替代內建副本執行，沿用內建副本的登入和資料；刪掉它就回到內建副本。啟用後它仍以應用的完整權限執行。',
        overrideConfirm: '替換',
        clearTitle: '清除音源資料',
        clearMessage: (id) => `清除音源“${id}”的資料嗎？`,
        clearDetail: '它會登出，並刪掉下面這些。刪掉的找不回來；停用音源不會刪這些。',
        clearConfirm: '清除',
        enable: '仍要啟用',
        communityTitle: '開啟社群模組',
        communityMessage: '允許安裝和執行社群模組嗎？',
        communityDetail: '社群模組是第三方程式碼，沒有 Folia 的官方簽名，可能也沒有經過安全審查。開啟後可以從 zip 或模組市場安裝任何模組；之前確認過的模組會立刻執行，其餘每個模組啟用前仍會單獨確認。啟用的模組以應用的完整權限執行。',
        communityConfirm: '開啟',
        rangeTitle: '嘗試載入版本宣告已過期的模組',
        rangeMessage: (name, id) => `仍要嘗試載入“${name}”（${id}）嗎？`,
        rangeBatchMessage: (count) => `仍要嘗試載入這 ${count} 個版本宣告已過期的模組嗎？`,
        rangeDetail: (range, version) => `作者宣告它只支援 Folia ${range}，當前是 ${version}。它多半還能用，但可能出錯或功能不全；出了問題請向模組作者反饋，不要反饋到 Folia。模組更新後要重新確認。`,
        rangeFeedback: (url) => `反饋位址：${url}`,
        rangeConfirm: '嘗試載入',
        uninstallTitle: '解除安裝模組',
        uninstallMessage: (name, id) => `解除安裝模組“${name}”（${id}）嗎？`,
        uninstallDetail: '模組資料夾會移到回收站，它存下的資料保留。',
        uninstallOverride: '解除安裝後回到隨應用安裝的內建版本。',
        uninstallConfirm: '解除安裝',
        cancel: '取消',
    },
    en: {
        title: 'Enable mod',
        message: (name, id) => `Enable the mod "${name}" (${id})?`,
        risk: 'Mods are third-party code. Once enabled, a mod runs with the full privileges of the app: it can read and write files, reach the network and change any setting. Only enable mods from sources you trust.',
        permissions: 'Declared permissions: ',
        noPermissions: 'Declared permissions: none',
        platformRead: (platforms) => `Reads platform data as you (experimental platform.raw): ${platforms}. The mod can read data on these platforms with the account you signed in to Folia with, such as your listening records.`,
        platformWrite: (platforms) => `Changes platform data as you: ${platforms}. The mod can also change what these platform accounts hold, such as likes, playlists and follows.`,
        queueReplace: 'Replaces the play queue (playback.queue): the mod can swap out the whole play queue in one go, which also ends Personal FM. Folia then says which mod replaced it; until the queue changes again, you can undo that and get the queue from before back.',
        equalizerControl: 'Changes your sound settings (equalizer.control): the mod can switch your sound preset, or put its own equalizer curve in place. Your custom sounds are never overwritten, and you can switch back in Audio effects at any time.',
        renderQuality: 'Changes the lyric canvas render quality (visualizer.renderQuality): the mod can change the lyric canvas resolution and anti-aliasing in Performance & motion, which lyric styles drawn with canvas or WebGL follow. What you set in the settings of a style itself is left as it is, and you can change it back in Performance & motion at any time.',
        visualizerMode: 'Switches your lyric animation style (visualizer.mode): the mod can change the lyric style for you, as you do in the player panel ("random lyric animation for every song" is switched off with it). You can switch back in the player panel at any time.',
        visualizerTuning: 'Changes the settings of lyric styles (visualizer.tuning): the mod can change the options of the builtin lyric styles, such as the camera, motion and decorations. Quality settings such as resolution are left as they are, and you can change them back in the style settings at any time.',
        visualizerBeatEffects: 'Changes the beat effects of smart beat mode (visualizer.beatEffects): the mod can switch the beat effects of each lyric style on or off and change their strength. Smart beat mode itself (Off / Analysed only / On) is always yours to choose; under On, though, the effects the mod switches on make the GPU analyse songs not yet analysed for them (effects on drum hits separate the drums).',
        visualizerBackground: 'Switches your background type (visualizer.background): the mod can change the background of the player for you, as you do in the background picker. Each background\'s own pictures and options are left as they are, and you can switch back in the player panel at any time.',
        visualizerAnimationIntensity: 'Changes the animation intensity (visualizer.animationIntensity): the mod can change how lively the lyrics and the background move, as you do in the player panel. You can change it back at any time.',
        themeWrite: 'Lays the mod\'s own theme over the song\'s theme (theme.write): the mod can change the colors of the player; the themes you saved are left as they are. Any theme you choose ends it, and you can take it off in the player panel at any time.',
        location: 'Installed at: ',
        fingerprint: 'Content fingerprint: ',
        client: 'UI code: ',
        noClient: 'UI code: none',
        experimental: 'Experimental APIs opted into: ',
        embedOrigins: 'External pages it may embed: ',
        folia: 'Needs Folia ',
        verifiedRisk: 'This mod carries a valid official Folium signature: it was reviewed and has not changed since signing. Once enabled it still runs with the full privileges of the app.',
        signatureVerified: (key) => `Signature: officially verified (${key})`,
        betaRisk: 'This is a preview build: it passed the security review only, and its features may be incomplete or not work at all. Once enabled it runs with the full privileges of the app.',
        signatureBeta: (key) => `Signature: preview build (${key})`,
        signatureUnsigned: 'Signature: none (a third-party mod not reviewed by Folium)',
        signatureInvalid: (reason) => `Signature: does not match (${reason}). The mod was changed after signing, or the signature is invalid; the signature can no longer vouch for it.`,
        rebind: 'This confirmation applies to the current files only; the mod must be confirmed again after its code changes.',
        devSource: 'Development mode: this mod is in the source tree\'s mods/ directory, so editing its files after this confirmation does not revoke it. Installed builds and the user mods directory have no such exemption.',
        sourceIntro: (sources) => `This mod provides music sources: ${sources}. It keeps your sign-in on these platforms, is not held to the network and storage limits of mods, and starts together with the app.`,
        takeover: (ids) => `It takes over sources this installation does not carry: ${ids}, and uses the sign-in you already have on these platforms (their songs in your queue, history and playlists keep working too).`,
        takeoverData: (items) => `Old data it takes over: ${items}`,
        takeoverNative: (names) => `It brings native programs of its own, which run directly on your computer (not the ones the app ships): ${names}`,
        certificateExceptions: (hosts) => `Relaxes certificate checks for these hosts: ${hosts}`,
        lyricRelayHosts: (hosts) => `Hosts whose lyric requests the app relays: ${hosts}`,
        selfSignedUserServers: (sources) => `Accepts a self-signed certificate from a server you enter yourself (such as a NAS at home): ${sources}`,
        overrideTitle: 'Replace a built-in mod with a newer version',
        overrideMessage: (name, id, version, builtinVersion) => `Replace the built-in "${name}" (${id}, version ${builtinVersion}) with version ${version}?`,
        overrideDetail: 'This copy carries a valid official Folium signature and is newer than the built-in copy installed with the app. Once confirmed it runs instead of the built-in copy and keeps its sign-in and data; removing it brings the built-in copy back. It still runs with the full privileges of the app.',
        overrideConfirm: 'Replace',
        clearTitle: 'Clear source data',
        clearMessage: (id) => `Clear the data of the source "${id}"?`,
        clearDetail: 'It is signed out and everything below is removed. What is removed cannot be brought back; turning a source off removes none of it.',
        clearConfirm: 'Clear',
        enable: 'Enable anyway',
        communityTitle: 'Turn on community mods',
        communityMessage: 'Allow installing and running community mods?',
        communityDetail: 'Community mods are third-party code without an official Folia signature, and may not have had a security review. Once this is on, any mod can be installed from a zip or the mod market; mods you confirmed before run at once, and any other mod is still confirmed on its own before it is enabled. An enabled mod runs with the full privileges of the app.',
        communityConfirm: 'Turn on',
        rangeTitle: 'Try a mod whose version range has expired',
        rangeMessage: (name, id) => `Try loading "${name}" (${id}) anyway?`,
        rangeBatchMessage: (count) => `Try loading these ${count} mods whose version range has expired?`,
        rangeDetail: (range, version) => `Its author says it supports Folia ${range}; this is ${version}. It will most likely still work, but it may fail or miss features. Report problems to the mod's author, not to Folia. After the mod updates you are asked again.`,
        rangeFeedback: (url) => `Report problems at: ${url}`,
        rangeConfirm: 'Try loading',
        uninstallTitle: 'Uninstall mod',
        uninstallMessage: (name, id) => `Uninstall the mod "${name}" (${id})?`,
        uninstallDetail: 'The mod folder is moved to the trash; the data it saved is kept.',
        uninstallOverride: 'The built-in version installed with the app runs again.',
        uninstallConfirm: 'Uninstall',
        cancel: 'Cancel',
    },
    in: {
        title: 'Aktifkan mod',
        message: (name, id) => `Aktifkan mod "${name}" (${id})?`,
        risk: 'Mod adalah kode pihak ketiga. Setelah diaktifkan, mod berjalan dengan hak penuh aplikasi: dapat membaca dan menulis berkas, mengakses jaringan, dan mengubah pengaturan apa pun. Aktifkan hanya mod dari sumber yang Anda percayai.',
        permissions: 'Izin yang dideklarasikan: ',
        noPermissions: 'Izin yang dideklarasikan: tidak ada',
        platformRead: (platforms) => `Membaca data platform atas nama Anda (API eksperimental platform.raw): ${platforms}. Mod dapat membaca data di platform ini dengan akun yang Anda pakai untuk masuk ke Folia, misalnya riwayat mendengarkan.`,
        platformWrite: (platforms) => `Mengubah data platform atas nama Anda: ${platforms}. Mod juga dapat mengubah isi akun platform ini, misalnya suka, playlist, dan yang diikuti.`,
        queueReplace: 'Mengganti antrean putar (playback.queue): mod dapat mengganti seluruh antrean putar sekaligus, sekaligus mengakhiri FM Pribadi. Setelah itu Folia memberi tahu mod mana yang menggantinya; selama antrean belum diubah lagi, Anda dapat mengurungkannya untuk kembali ke antrean sebelumnya.',
        equalizerControl: 'Mengubah pengaturan suara Anda (equalizer.control): mod dapat mengganti preset suara Anda, atau memasang kurva equalizer miliknya sendiri. Suara kustom Anda tidak pernah ditimpa, dan Anda dapat kembali kapan saja di Efek audio.',
        renderQuality: 'Mengubah kualitas render kanvas lirik (visualizer.renderQuality): mod dapat mengubah resolusi dan anti-aliasing kanvas lirik di Performa & gerakan, yang diikuti gaya lirik yang digambar dengan canvas atau WebGL. Pengaturan milik masing-masing gaya tidak diubah, dan Anda dapat mengembalikannya kapan saja di Performa & gerakan.',
        visualizerMode: 'Mengganti gaya animasi lirik Anda (visualizer.mode): mod dapat mengganti gaya lirik untuk Anda, seperti yang Anda lakukan di panel pemutar ("gaya acak untuk setiap lagu" ikut dimatikan). Anda dapat menggantinya kembali di panel pemutar kapan saja.',
        visualizerTuning: 'Mengubah pengaturan gaya lirik (visualizer.tuning): mod dapat mengubah opsi gaya lirik bawaan, seperti kamera, gerakan, dan dekorasi. Pengaturan kualitas seperti resolusi tidak diubah, dan Anda dapat mengembalikannya di pengaturan gaya kapan saja.',
        visualizerBeatEffects: 'Mengubah efek ketukan mode ketukan pintar (visualizer.beatEffects): mod dapat menyalakan atau mematikan efek ketukan setiap gaya lirik dan mengubah kekuatannya. Mode ketukan pintar itu sendiri (Nonaktif / Hanya yang sudah dianalisis / Aktif) selalu Anda yang memilih; namun saat Aktif, efek yang dinyalakan mod membuat GPU menganalisis lagu yang belum dianalisis untuk efek itu (efek pada pukulan drum memisahkan drum).',
        visualizerBackground: 'Mengganti jenis latar belakang Anda (visualizer.background): mod dapat mengganti latar belakang pemutar untuk Anda, seperti yang Anda lakukan di pemilih latar belakang. Gambar dan opsi setiap latar belakang tidak diubah, dan Anda dapat menggantinya kembali di panel pemutar kapan saja.',
        visualizerAnimationIntensity: 'Mengubah intensitas animasi (visualizer.animationIntensity): mod dapat mengubah seberapa hidup gerakan lirik dan latar belakang, seperti yang Anda lakukan di panel pemutar. Anda dapat mengubahnya kembali kapan saja.',
        themeWrite: 'Memasang tema milik mod di atas tema lagu (theme.write): mod dapat mengganti warna pemutar; tema yang Anda simpan tidak diubah. Tema apa pun yang Anda pilih mengakhirinya, dan Anda dapat melepasnya di panel pemutar kapan saja.',
        location: 'Terpasang di: ',
        fingerprint: 'Sidik konten: ',
        client: 'Kode antarmuka: ',
        noClient: 'Kode antarmuka: tidak ada',
        experimental: 'API eksperimental yang dipakai: ',
        embedOrigins: 'Halaman eksternal yang dapat disematkan: ',
        folia: 'Membutuhkan Folia ',
        verifiedRisk: 'Mod ini memiliki tanda tangan resmi Folium yang valid: sudah ditinjau dan tidak berubah sejak ditandatangani. Setelah diaktifkan, mod tetap berjalan dengan hak penuh aplikasi.',
        signatureVerified: (key) => `Tanda tangan: terverifikasi resmi (${key})`,
        betaRisk: 'Ini versi pratinjau: hanya lolos tinjauan keamanan, dan fiturnya mungkin belum lengkap atau tidak berfungsi sama sekali. Setelah diaktifkan, mod berjalan dengan hak penuh aplikasi.',
        signatureBeta: (key) => `Tanda tangan: versi pratinjau (${key})`,
        signatureUnsigned: 'Tanda tangan: tidak ada (mod pihak ketiga yang belum ditinjau Folium)',
        signatureInvalid: (reason) => `Tanda tangan: tidak cocok (${reason}). Mod diubah setelah ditandatangani, atau tanda tangannya tidak valid; tanda tangan ini tidak lagi bisa menjaminnya.`,
        rebind: 'Konfirmasi ini hanya berlaku untuk berkas saat ini; mod harus dikonfirmasi ulang setelah kodenya berubah.',
        devSource: 'Mode pengembangan: mod ini ada di direktori mods/ pada kode sumber, jadi mengubah berkasnya setelah konfirmasi ini tidak membatalkannya. Build terpasang dan direktori mod pengguna tidak mendapat pengecualian ini.',
        sourceIntro: (sources) => `Mod ini menyediakan sumber musik: ${sources}. Mod ini menyimpan login Anda di platform tersebut, tidak terikat batas jaringan dan penyimpanan mod, dan dimulai bersama aplikasi.`,
        takeover: (ids) => `Mod ini mengambil alih sumber yang tidak dibawa instalasi ini: ${ids}, dan memakai login Anda yang sudah ada di platform tersebut (lagu-lagunya di antrean, riwayat, dan playlist tetap berfungsi).`,
        takeoverData: (items) => `Data lama yang diambil alih: ${items}`,
        takeoverNative: (names) => `Membawa program native sendiri yang langsung berjalan di komputer Anda (bukan yang disertakan aplikasi): ${names}`,
        certificateExceptions: (hosts) => `Melonggarkan pemeriksaan sertifikat untuk host ini: ${hosts}`,
        lyricRelayHosts: (hosts) => `Host yang permintaan liriknya diteruskan aplikasi: ${hosts}`,
        selfSignedUserServers: (sources) => `Menerima sertifikat yang ditandatangani sendiri dari server yang Anda isi sendiri (misalnya NAS di rumah): ${sources}`,
        overrideTitle: 'Ganti mod bawaan dengan versi yang lebih baru',
        overrideMessage: (name, id, version, builtinVersion) => `Ganti "${name}" bawaan (${id}, versi ${builtinVersion}) dengan versi ${version}?`,
        overrideDetail: 'Salinan ini memiliki tanda tangan resmi Folium yang valid dan lebih baru daripada salinan bawaan yang terpasang bersama aplikasi. Setelah dikonfirmasi, salinan ini berjalan menggantikan salinan bawaan dan memakai login serta datanya; menghapusnya mengembalikan salinan bawaan. Salinan ini tetap berjalan dengan hak penuh aplikasi.',
        overrideConfirm: 'Ganti',
        clearTitle: 'Hapus data sumber',
        clearMessage: (id) => `Hapus data sumber "${id}"?`,
        clearDetail: 'Sumber ini akan keluar dari akun dan semua di bawah ini dihapus. Yang dihapus tidak bisa dikembalikan; menonaktifkan sumber tidak menghapus apa pun dari ini.',
        clearConfirm: 'Hapus',
        enable: 'Tetap aktifkan',
        communityTitle: 'Aktifkan mod komunitas',
        communityMessage: 'Izinkan memasang dan menjalankan mod komunitas?',
        communityDetail: 'Mod komunitas adalah kode pihak ketiga tanpa tanda tangan resmi Folia, dan mungkin belum melewati tinjauan keamanan. Setelah diaktifkan, mod apa pun bisa dipasang dari zip atau pasar mod; mod yang sudah pernah Anda konfirmasi langsung berjalan, dan mod lain tetap dikonfirmasi sendiri sebelum diaktifkan. Mod yang aktif berjalan dengan hak penuh aplikasi.',
        communityConfirm: 'Aktifkan',
        rangeTitle: 'Coba mod yang rentang versinya sudah kedaluwarsa',
        rangeMessage: (name, id) => `Tetap coba muat "${name}" (${id})?`,
        rangeBatchMessage: (count) => `Tetap coba muat ${count} mod yang rentang versinya sudah kedaluwarsa ini?`,
        rangeDetail: (range, version) => `Pembuatnya menyatakan mod ini mendukung Folia ${range}; versi ini ${version}. Kemungkinan besar mod masih berfungsi, tetapi bisa gagal atau fiturnya tidak lengkap. Laporkan masalah ke pembuat mod, bukan ke Folia. Setelah mod diperbarui, Anda akan ditanya lagi.`,
        rangeFeedback: (url) => `Laporkan masalah di: ${url}`,
        rangeConfirm: 'Coba muat',
        uninstallTitle: 'Copot mod',
        uninstallMessage: (name, id) => `Copot mod "${name}" (${id})?`,
        uninstallDetail: 'Folder mod dipindahkan ke tempat sampah; data yang disimpannya tetap ada.',
        uninstallOverride: 'Versi bawaan yang terpasang bersama aplikasi akan berjalan lagi.',
        uninstallConfirm: 'Copot',
        cancel: 'Batal',
    },
    vi: {
        title: 'Bật mod',
        message: (name, id) => `Bạn có chắc chắn muốn bật mod “${name}” (${id}) không?`,
        risk: 'Mod là mã của bên thứ ba. Khi được bật, mod chạy với toàn bộ quyền hạn của ứng dụng: có thể đọc ghi tệp, truy cập mạng và thay đổi mọi cài đặt. Chỉ bật mod từ nguồn bạn tin cậy.',
        permissions: 'Các quyền khai báo: ',
        noPermissions: 'Các quyền khai báo: không có',
        platformRead: (platforms) => `Đọc dữ liệu nền tảng dưới danh nghĩa tài khoản của bạn (giao diện thử nghiệm platform.raw): ${platforms}. Mod có thể đọc dữ liệu trên các nền tảng này bằng tài khoản bạn đã đăng nhập vào Folia, chẳng hạn như lịch sử nghe.`,
        platformWrite: (platforms) => `Đổi dữ liệu nền tảng dưới danh nghĩa bạn: ${platforms}. Mod có thể thay đổi nội dung trong các tài khoản này, như lượt thích, danh sách phát và theo dõi.`,
        queueReplace: 'Thay thế hàng đợi phát (playback.queue): mod có thể hoán đổi toàn bộ hàng đợi phát cùng một lúc, thao tác này cũng kết thúc Radio cá nhân. Folia sẽ cho biết mod nào đã thay thế; cho đến khi hàng đợi thay đổi lại, bạn có thể hoàn tác để lấy lại hàng đợi trước đó.',
        equalizerControl: 'Thay đổi cài đặt âm thanh của bạn (equalizer.control): mod có thể chuyển đổi cấu hình âm thanh đặt sẵn hoặc áp dụng đường cong bộ chỉnh âm riêng. Âm thanh tùy chỉnh của bạn sẽ không bao giờ bị ghi đè và bạn có thể chuyển lại trong Hiệu ứng âm thanh bất kỳ lúc nào.',
        renderQuality: 'Thay đổi chất lượng kết xuất khung lời bài hát (visualizer.renderQuality): mod có thể thay đổi độ phân giải và khử răng cưa của khung lời bài hát trong Hiệu năng & Hoạt họa, mà các kiểu lời bài hát vẽ bằng canvas hoặc WebGL sẽ theo. Cài đặt riêng của từng kiểu không bị ảnh hưởng và bạn có thể đổi lại trong Hiệu năng & Hoạt họa bất kỳ lúc nào.',
        visualizerMode: 'Chuyển kiểu hoạt họa lời bài hát của bạn (visualizer.mode): mod có thể đổi kiểu lời bài hát thay bạn, như khi bạn đổi trong bảng phát nhạc ("một kiểu ngẫu nhiên cho mỗi bài" cũng sẽ tắt theo). Bạn có thể đổi lại trong bảng phát nhạc bất kỳ lúc nào.',
        visualizerTuning: 'Thay đổi cài đặt của các kiểu lời bài hát (visualizer.tuning): mod có thể thay đổi tùy chọn của các kiểu lời bài hát tích hợp, như máy quay, chuyển động và trang trí. Các cài đặt chất lượng như độ phân giải không bị ảnh hưởng và bạn có thể đổi lại trong cài đặt kiểu bất kỳ lúc nào.',
        visualizerBeatEffects: 'Thay đổi hiệu ứng nhịp của chế độ nhịp thông minh (visualizer.beatEffects): mod có thể bật tắt hiệu ứng nhịp của từng kiểu lời bài hát và chỉnh cường độ. Bản thân chế độ nhịp thông minh (Tắt / Chỉ bài đã phân tích / Bật) luôn do bạn quyết định; nhưng ở chế độ Bật, các hiệu ứng mà mod bật sẽ khiến GPU phân tích những bài chưa được phân tích cho chúng (hiệu ứng theo tiếng trống sẽ tách tiếng trống).',
        visualizerBackground: 'Chuyển kiểu nền của bạn (visualizer.background): mod có thể đổi nền của trình phát thay bạn, như khi bạn đổi trong bộ chọn nền. Hình ảnh và tùy chọn riêng của từng nền không bị ảnh hưởng và bạn có thể đổi lại trong bảng phát nhạc bất kỳ lúc nào.',
        visualizerAnimationIntensity: 'Thay đổi cường độ hiệu ứng (visualizer.animationIntensity): mod có thể chỉnh mức độ sôi động của chuyển động lời bài hát và nền, như khi bạn chỉnh trong bảng phát nhạc. Bạn có thể đổi lại bất kỳ lúc nào.',
        themeWrite: 'Đặt chủ đề riêng của mod lên trên chủ đề của bài hát (theme.write): mod có thể đổi màu sắc của trình phát; các chủ đề bạn đã lưu không bị thay đổi. Bất kỳ chủ đề nào bạn chọn sẽ kết thúc nó và bạn có thể gỡ nó trong bảng phát nhạc bất kỳ lúc nào.',
        location: 'Vị trí cài đặt: ',
        fingerprint: 'Mã định danh nội dung: ',
        client: 'Mã giao diện: ',
        noClient: 'Mã giao diện: không có',
        experimental: 'Giao diện thử nghiệm tùy chọn: ',
        embedOrigins: 'Trang web bên ngoài có thể nhúng: ',
        folia: 'Yêu cầu phiên bản Folia ',
        verifiedRisk: 'Mod này có chữ ký chính thức hợp lệ của Folium: đã được xem xét và không bị sửa đổi kể từ khi ký. Sau khi bật, mod vẫn chạy với toàn bộ quyền hạn của ứng dụng.',
        signatureVerified: (key) => `Chữ ký: Chứng nhận chính thức (${key})`,
        betaRisk: 'Đây là bản thử nghiệm sớm: chỉ mới vượt qua kiểm tra an toàn, tính năng có thể chưa đầy đủ hoặc không hoạt động. Sau khi bật, mod chạy với toàn bộ quyền hạn của ứng dụng.',
        signatureBeta: (key) => `Chữ ký: Thử nghiệm sớm (${key})`,
        signatureUnsigned: 'Chữ ký: Không có (mod bên thứ ba chưa được Folium xem xét)',
        signatureInvalid: (reason) => `Chữ ký: Không khớp (${reason}). Nội dung mod đã bị sửa đổi sau khi ký hoặc chữ ký không hợp lệ; chữ ký này không còn giá trị chứng nhận.`,
        rebind: 'Xác nhận này chỉ có hiệu lực với nội dung tệp hiện tại; bạn sẽ cần xác nhận lại nếu mã mod bị thay đổi.',
        devSource: 'Chế độ phát triển: Mod này nằm trong thư mục mods/ của mã nguồn, do đó chỉnh sửa tệp sau khi xác nhận sẽ không hủy bỏ xác nhận này. Bản cài đặt và thư mục mod người dùng không được miễn trừ.',
        sourceIntro: (sources) => `Mod này cung cấp nguồn nhạc: ${sources}. Mod sẽ giữ thông tin đăng nhập của bạn trên các nền tảng này, không bị giới hạn mạng và lưu trữ dành cho mod, và khởi động cùng ứng dụng.`,
        takeover: (ids) => `Mod sẽ tiếp quản các nguồn mà bản cài đặt này không kèm theo: ${ids}, và dùng thông tin đăng nhập sẵn có của bạn trên các nền tảng này (bài hát của chúng trong hàng đợi, lịch sử và danh sách phát vẫn dùng được).`,
        takeoverData: (items) => `Dữ liệu cũ được tiếp quản: ${items}`,
        takeoverNative: (names) => `Mang theo chương trình gốc của riêng nó, chạy trực tiếp trên máy tính của bạn (không phải bản đi kèm ứng dụng): ${names}`,
        certificateExceptions: (hosts) => `Nới lỏng kiểm tra chứng chỉ cho các tên miền này: ${hosts}`,
        lyricRelayHosts: (hosts) => `Các tên miền mà ứng dụng chuyển tiếp yêu cầu lời bài hát: ${hosts}`,
        selfSignedUserServers: (sources) => `Chấp nhận chứng chỉ tự ký của máy chủ do bạn tự nhập (ví dụ NAS ở nhà): ${sources}`,
        overrideTitle: 'Thay mod tích hợp bằng phiên bản mới hơn',
        overrideMessage: (name, id, version, builtinVersion) => `Thay “${name}” tích hợp (${id}, phiên bản ${builtinVersion}) bằng phiên bản ${version}?`,
        overrideDetail: 'Bản này có chữ ký chính thức hợp lệ của Folium và mới hơn bản tích hợp được cài cùng ứng dụng. Sau khi xác nhận, bản này chạy thay cho bản tích hợp và giữ nguyên đăng nhập cùng dữ liệu của nó; xóa bản này sẽ quay về bản tích hợp. Bản này vẫn chạy với toàn bộ quyền hạn của ứng dụng.',
        overrideConfirm: 'Thay',
        clearTitle: 'Xóa dữ liệu nguồn',
        clearMessage: (id) => `Xóa dữ liệu của nguồn “${id}”?`,
        clearDetail: 'Nguồn sẽ đăng xuất và mọi thứ bên dưới sẽ bị xóa. Những gì đã xóa không thể khôi phục; tắt nguồn không xóa những thứ này.',
        clearConfirm: 'Xóa',
        enable: 'Vẫn bật',
        communityTitle: 'Bật mod cộng đồng',
        communityMessage: 'Cho phép cài đặt và chạy mod cộng đồng?',
        communityDetail: 'Mod cộng đồng là mã của bên thứ ba, không có chữ ký chính thức của Folia và có thể chưa qua đánh giá bảo mật. Khi bật, có thể cài bất kỳ mod nào từ zip hoặc kho mod; các mod bạn đã xác nhận trước đó sẽ chạy ngay, mọi mod khác vẫn được xác nhận riêng trước khi bật. Mod đã bật chạy với toàn bộ quyền hạn của ứng dụng.',
        communityConfirm: 'Bật',
        rangeTitle: 'Thử tải mod có khai báo phiên bản đã hết hạn',
        rangeMessage: (name, id) => `Vẫn thử tải “${name}” (${id})?`,
        rangeBatchMessage: (count) => `Vẫn thử tải ${count} mod có khai báo phiên bản đã hết hạn này?`,
        rangeDetail: (range, version) => `Tác giả khai báo mod hỗ trợ Folia ${range}; phiên bản hiện tại là ${version}. Nhiều khả năng mod vẫn chạy được, nhưng có thể lỗi hoặc thiếu tính năng. Hãy báo lỗi cho tác giả mod, không phải cho Folia. Sau khi mod cập nhật, bạn sẽ được hỏi lại.`,
        rangeFeedback: (url) => `Báo lỗi tại: ${url}`,
        rangeConfirm: 'Thử tải',
        uninstallTitle: 'Gỡ mod',
        uninstallMessage: (name, id) => `Gỡ mod “${name}” (${id})?`,
        uninstallDetail: 'Thư mục mod sẽ được chuyển vào thùng rác; dữ liệu mod đã lưu vẫn được giữ.',
        uninstallOverride: 'Phiên bản tích hợp cài cùng ứng dụng sẽ chạy lại.',
        uninstallConfirm: 'Gỡ',
        cancel: 'Hủy',
    },
};

/*
 * `app` is Electron's. The rest is the loader's: `store` is where approvals
 * are kept (`enabledKey(modId)` names one mod's record in it),
 * `getMainWindowSafe` gives the window the dialog belongs to, and
 * `getLocaleKey` the language to ask in.
 */
const createModApproval = ({ app, store, enabledKey, getMainWindowSafe, getLocaleKey }) => {
    // Folium 2.0 (plan §5.1): a built-in mod's switch and the one confirmation of an override copy, apart
    // from the digest-bound approvals of every other mod (`enabledKey`), so a same-id copy in a user folder
    // never shares a record with the built-in one.
    const builtinKey = (modId) => `${String(enabledKey(modId)).replace(/\.enabled\./, '.builtin.')}`;
    const overrideKey = (modId) => `${String(enabledKey(modId)).replace(/\.enabled\./, '.override.')}`;

    const resolveDialogLocale = () => {
        try {
            const key = typeof getLocaleKey === 'function' ? getLocaleKey() : null;
            return TRUST_DIALOG_LOCALE[key] ?? TRUST_DIALOG_LOCALE.en;
        } catch {
            return TRUST_DIALOG_LOCALE.en;
        }
    };

    /*
     * Persisted trust record: `{ enabled, digest }`. Anything that is not an
     * object (nothing yet, or a value of another shape) reads as no record: the
     * mod stays off until the user confirms it.
     */
    const readTrust = (modId) => {
        try {
            const stored = store.get(enabledKey(modId));
            if (!stored || typeof stored !== 'object') {
                return null;
            }
            return {
                enabled: Boolean(stored.enabled),
                digest: typeof stored.digest === 'string' ? stored.digest : null,
            };
        } catch {
            return null;
        }
    };

    const writeTrust = (modId, enabled, digest) => {
        try {
            store.set(enabledKey(modId), {
                enabled: Boolean(enabled),
                digest: enabled ? digest : null,
                confirmedAt: enabled ? new Date().toISOString() : null,
            });
        } catch {
            // Persistence is best-effort; in-memory state still applies.
        }
    };

    /*
     * A built-in mod is on unless switched off: no record reads as enabled, and nothing about it is bound
     * to a digest (plan §5.1, `approval.cjs:248-279` in §5.4).
     */
    const readBuiltinEnabled = (modId) => {
        try {
            const stored = store.get(builtinKey(modId));
            return !(stored && typeof stored === 'object' && stored.enabled === false);
        } catch {
            return true;
        }
    };

    const writeBuiltinEnabled = (modId, enabled) => {
        try {
            store.set(builtinKey(modId), { enabled: Boolean(enabled), changedAt: new Date().toISOString() });
        } catch {
            // Persistence is best-effort; in-memory state still applies.
        }
    };

    /* Whether the user confirmed this copy (by its digest) as the override of a built-in mod. */
    const isOverrideConfirmed = (modId, digest) => {
        try {
            const stored = store.get(overrideKey(modId));
            return Boolean(digest && stored && typeof stored === 'object' && stored.digest === digest);
        } catch {
            return false;
        }
    };

    // A null `digest` takes the confirmation back (uninstalling the override copy).
    const writeOverrideApproval = (modId, digest) => {
        try {
            store.set(overrideKey(modId), digest ? { digest, confirmedAt: new Date().toISOString() } : null);
        } catch {
            // Best-effort, as above.
        }
    };

    /*
     * A mod whose `folia` range only ran out above (manifest.cjs classifyHostRange 'expired'), loaded anyway
     * because the user said so. Bound to the files like an approval: an update has to be confirmed again.
     */
    const rangeKey = (modId) => `${String(enabledKey(modId)).replace(/\.enabled\./, '.range.')}`;

    const isRangeOverrideConfirmed = (modId, digest) => {
        try {
            const stored = store.get(rangeKey(modId));
            return Boolean(digest && stored && typeof stored === 'object' && stored.digest === digest);
        } catch {
            return false;
        }
    };

    // A null `digest` takes the permission back (a record that is not an object reads as none).
    const writeRangeOverride = (modId, digest) => {
        try {
            store.set(rangeKey(modId), digest ? { digest, confirmedAt: new Date().toISOString() } : null);
        } catch {
            // Best-effort, as above.
        }
    };

    /*
     * Development exemption. In an unpackaged build (npm run dev:electron) a mod
     * in the repository's own mods/ directory, the developer's source tree,
     * keeps its approval when its files change: the first enable is still
     * confirmed, later edits rebind the approval to the new bytes instead of
     * revoking it. Mods under userData or resources never qualify: that is where
     * files arrive from elsewhere, which is what binding trust to bytes guards
     * against. A packaged app never scans the repository directory at all.
     */
    const isDevSourceMod = (dirPath) => {
        if (app.isPackaged || typeof dirPath !== 'string') {
            return false;
        }
        const relative = path.relative(path.join(app.getAppPath(), 'mods'), dirPath);
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    };

    /*
     * Decides whether a discovered mod may run. Trust is granted to bytes, not
     * to a mod id: when the digest moved (an upgrade dropped in over the old
     * copy, or an edited file) the approval is revoked on the spot and the mod
     * stays off until the user confirms the new code. The one exception is a
     * development source mod (isDevSourceMod) that was already confirmed: its
     * approval follows the edit.
     */
    const resolveTrust = (modId, digest, { devSource = false } = {}) => {
        const stored = readTrust(modId);
        if (!stored || !stored.enabled) {
            return { enabled: false, trustStale: false };
        }
        if (!digest || stored.digest !== digest) {
            if (devSource && digest && stored.digest) {
                writeTrust(modId, true, digest);
                console.info(`[ModSystem] ${modId}: files changed in the development source tree; approval kept`);
                return { enabled: true, trustStale: false };
            }
            writeTrust(modId, false, null);
            return { enabled: false, trustStale: true };
        }
        return { enabled: true, trustStale: false };
    };

    /*
     * The enable confirmation. Native and main-process owned on purpose: a
     * loaded mod's client code shares the renderer with the app UI, so a dialog
     * drawn there could be spoofed or dismissed by mod code. This one cannot,
     * and it is the only path that writes an "enabled" trust record.
     */
    /*
     * The extra lines of a source mod (plan §5.2 and §5.1): what it provides, what it keeps; for a takeover,
     * each source id it takes over and the old data it will use. `sources` are the resolved ones
     * (sourceOwnership.cjs).
     */
    const sourceLines = (locale, manifest, sources, dirPath = null) => {
        if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) return [];
        const nameOf = (entry) => (typeof entry.name === 'string' ? entry.name : entry.name?.en ?? Object.values(entry.name ?? {})[0] ?? entry.id);
        const described = manifest.sources.map((entry) => {
            const resolved = (sources ?? []).find((source) => source.localId === entry.id);
            return `${nameOf(entry)} (${resolved?.sourceId ?? entry.id})`;
        });
        const lines = [locale.sourceIntro(described.join(', '))];
        const takeovers = (sources ?? []).filter((source) => source.takeover);
        if (takeovers.length > 0) {
            lines.push(locale.takeover(takeovers.map((source) => source.sourceId).join(', ')));
            const data = takeovers.flatMap((source) => [
                ...source.legacy.storeKeys,
                ...source.legacy.partitions.map((partition) => `partition ${partition}`),
                ...source.legacy.userDataDirs.map((folder) => `userData/${folder}`),
                ...(source.legacy.cacheDirs ?? []).map((folder) => `cache/${folder}`),
            ]);
            if (data.length > 0) lines.push(locale.takeoverData(data.join(', ')));
            // Its own native files: the names it may resolve that resolve in its folder on this system (nativeFiles.cjs
            // resolveModNativeFile, as api.native will). Without the folder to look in, every name it may resolve.
            const ownNative = [...new Set(takeovers.flatMap((source) => source.legacy.ownNative ?? []))]
                .filter((name) => !dirPath || Boolean(resolveModNativeFile(name, dirPath, { platform: process.platform, arch: process.arch, fs }).path));
            if (ownNative.length > 0) lines.push(locale.takeoverNative(ownNative.join(', ')));
        }
        const hosts = (field) => [...new Set(manifest.sources.flatMap((entry) => entry[field] ?? []))];
        if (hosts('certificateExceptions').length > 0) lines.push(locale.certificateExceptions(hosts('certificateExceptions').join(', ')));
        if (hosts('lyricRelayHosts').length > 0) lines.push(locale.lyricRelayHosts(hosts('lyricRelayHosts').join(', ')));
        // A source that connects to a server the user enters (a NAS at home) and accepts its self-signed certificate
        // (`sources[].selfSignedUserServers`): its main entry makes those requests itself, so this is what it says it does.
        const selfSigned = manifest.sources.filter((entry) => entry.selfSignedUserServers === true).map((entry) => nameOf(entry));
        if (selfSigned.length > 0) lines.push(locale.selfSignedUserServers(selfSigned.join(', ')));
        return lines;
    };

    const showDialog = async (options) => {
        const win = getMainWindowSafe();
        const result = win && !win.isDestroyed()
            ? await dialog.showMessageBox(win, options)
            : await dialog.showMessageBox(options);
        return result.response === 1;
    };

    /*
     * The one confirmation of an override copy (plan §5.1): a signed, newer copy of a built-in mod. The label
     * line says the signature as it is.
     */
    const confirmOverride = async (runtime, digest, signature, builtinVersion) => {
        const locale = resolveDialogLocale();
        const keyText = signature.keyLabel ? `${signature.keyLabel}, ${signature.keyId}` : signature.keyId;
        return showDialog({
            type: 'warning',
            title: locale.overrideTitle,
            message: locale.overrideMessage(runtime.manifest.name, runtime.manifest.id, runtime.manifest.version, builtinVersion ?? '-'),
            detail: [
                locale.overrideDetail,
                '',
                locale.signatureVerified(keyText),
                ...sourceLines(locale, runtime.manifest, runtime.source?.sources, runtime.dirPath),
                `${locale.location}${runtime.dirPath ?? '-'}`,
                `${locale.fingerprint}${shortDigest(digest)}`,
                '',
                locale.rebind,
            ].join('\n'),
            buttons: [locale.cancel, locale.overrideConfirm],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
    };

    /*
     * "Clear data" of a source (plan §5.3): what goes is listed, and the main process asks, so page code cannot
     * clear a sign-in on its own. `items` is describeSourceData's answer.
     */
    const confirmClearSourceData = async (sourceId, items) => {
        const locale = resolveDialogLocale();
        const lines = [
            ...items.storeKeys,
            ...items.partitions.map((partition) => `partition ${partition}`),
            ...items.userDataDirs,
            ...(items.cacheDirs ?? []),
            items.modData,
            items.modCache,
            ...items.pageStorePrefixes.map((prefix) => `${prefix}*`),
        ];
        return showDialog({
            type: 'warning',
            title: locale.clearTitle,
            message: locale.clearMessage(sourceId),
            detail: [locale.clearDetail, '', ...lines].join('\n'),
            buttons: [locale.cancel, locale.clearConfirm],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
    };

    /*
     * The one confirmation before community mods are allowed (communityMods.cjs): what they are and what an enabled
     * one can do. Each mod is still confirmed on its own (confirmEnableMod) before it runs.
     */
    const confirmCommunityMods = async () => {
        const locale = resolveDialogLocale();
        return showDialog({
            type: 'warning',
            title: locale.communityTitle,
            message: locale.communityMessage,
            detail: locale.communityDetail,
            buttons: [locale.cancel, locale.communityConfirm],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
    };

    /*
     * Loading mods whose `folia` range ran out above anyway (B4 of the Folium 2 market plan). `entries` are
     * `{ name, id, range, feedbackUrl }`; one dialog for one mod or for a batch.
     */
    const confirmRangeOverride = async (entries, hostVersion) => {
        const locale = resolveDialogLocale();
        const list = Array.isArray(entries) ? entries : [];
        if (list.length === 0) return false;
        const first = list[0];
        const lines = list.length === 1
            ? [
                locale.rangeDetail(first.range ?? '-', hostVersion),
                ...(first.feedbackUrl ? ['', locale.rangeFeedback(first.feedbackUrl)] : []),
            ]
            : [
                locale.rangeDetail(list.map((entry) => entry.range).filter(Boolean).filter((range, index, all) => all.indexOf(range) === index).join(' / ') || '-', hostVersion),
                '',
                ...list.map((entry) => `${entry.name} (${entry.id})${entry.range ? `: ${entry.range}` : ''}`),
            ];
        return showDialog({
            type: 'warning',
            title: locale.rangeTitle,
            message: list.length === 1 ? locale.rangeMessage(first.name, first.id) : locale.rangeBatchMessage(String(list.length)),
            detail: lines.join('\n'),
            buttons: [locale.cancel, locale.rangeConfirm],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
    };

    /* Uninstalling a mod from the user's folder; `restoresBuiltin` when a built-in copy of the same id runs again. */
    const confirmUninstall = async (runtime, { restoresBuiltin = false } = {}) => {
        const locale = resolveDialogLocale();
        return showDialog({
            type: 'question',
            title: locale.uninstallTitle,
            message: locale.uninstallMessage(runtime.manifest.name, runtime.manifest.id),
            detail: [
                locale.uninstallDetail,
                ...(restoresBuiltin ? [locale.uninstallOverride] : []),
                `${locale.location}${runtime.dirPath ?? '-'}`,
            ].join('\n'),
            buttons: [locale.cancel, locale.uninstallConfirm],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
    };

    /*
     * `rangeExpired` ({ range, hostVersion, feedbackUrl }): the mod's `folia` range ran out above, and this
     * confirmation also lets it load anyway (the caller records that with the trust).
     */
    const confirmEnableMod = async (runtime, digest, signature, { rangeExpired = null } = {}) => {
        const locale = resolveDialogLocale();
        const keyText = signature.keyLabel ? `${signature.keyLabel}, ${signature.keyId}` : signature.keyId;
        const signatureLine = signature.status === 'verified'
            ? locale.signatureVerified(keyText)
            : signature.status === 'beta'
                ? locale.signatureBeta(keyText)
                : signature.status === 'invalid'
                    ? locale.signatureInvalid(signature.reason ?? 'invalid')
                    : locale.signatureUnsigned;
        const permissions = Array.isArray(runtime.manifest.permissions) ? runtime.manifest.permissions : [];
        const { client, experimental = [], embedOrigins = [], folia } = runtime.manifest;
        // Folium 1.7: the platforms the mod may call as the user (platform.<id>.read / .write), said in words.
        const platformsWith = (access) => permissions
            .map((permission) => /^platform\.([^.]+)\.(read|write)$/.exec(String(permission)))
            .filter((match) => match && match[2] === access)
            .map((match) => match[1]);
        const readPlatforms = platformsWith('read');
        const writePlatforms = platformsWith('write');
        const detail = [
            signature.status === 'verified' ? locale.verifiedRisk : signature.status === 'beta' ? locale.betaRisk : locale.risk,
            ...(rangeExpired ? ['', locale.rangeDetail(rangeExpired.range ?? '-', rangeExpired.hostVersion ?? '-')] : []),
            ...(rangeExpired?.feedbackUrl ? [locale.rangeFeedback(rangeExpired.feedbackUrl)] : []),
            '',
            signatureLine,
            permissions.length > 0 ? `${locale.permissions}${permissions.join(', ')}` : locale.noPermissions,
            ...(readPlatforms.length > 0 ? [locale.platformRead(readPlatforms.join(', '))] : []),
            ...(writePlatforms.length > 0 ? [locale.platformWrite(writePlatforms.join(', '))] : []),
            ...(permissions.includes('playback.queue') ? [locale.queueReplace] : []),
            ...(permissions.includes('equalizer.control') ? [locale.equalizerControl] : []),
            ...(permissions.includes('visualizer.renderQuality') ? [locale.renderQuality] : []),
            ...(permissions.includes('visualizer.mode') ? [locale.visualizerMode] : []),
            ...(permissions.includes('visualizer.tuning') ? [locale.visualizerTuning] : []),
            ...(permissions.includes('visualizer.beatEffects') ? [locale.visualizerBeatEffects] : []),
            ...(permissions.includes('visualizer.background') ? [locale.visualizerBackground] : []),
            ...(permissions.includes('visualizer.animationIntensity') ? [locale.visualizerAnimationIntensity] : []),
            ...(permissions.includes('theme.write') ? [locale.themeWrite] : []),
            client ? `${locale.client}${client}` : locale.noClient,
            ...(experimental.length > 0 ? [`${locale.experimental}${experimental.join(', ')}`] : []),
            ...(embedOrigins.length > 0 ? [`${locale.embedOrigins}${embedOrigins.join(', ')}`] : []),
            ...(folia ? [`${locale.folia}${folia}`] : []),
            ...sourceLines(locale, runtime.manifest, runtime.source?.sources, runtime.dirPath),
            `${locale.location}${runtime.dirPath ?? '-'}`,
            `${locale.fingerprint}${shortDigest(digest)}`,
            '',
            isDevSourceMod(runtime.dirPath) ? locale.devSource : locale.rebind,
        ].join('\n');
        const options = {
            type: 'warning',
            title: locale.title,
            message: locale.message(runtime.manifest.name, runtime.manifest.id),
            detail,
            buttons: [locale.cancel, locale.enable],
            // Cancel is the default so an accidental Enter never enables a mod.
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        };
        const win = getMainWindowSafe();
        const result = win && !win.isDestroyed()
            ? await dialog.showMessageBox(win, options)
            : await dialog.showMessageBox(options);
        return result.response === 1;
    };

    return {
        writeTrust,
        isDevSourceMod,
        resolveTrust,
        confirmEnableMod,
        readBuiltinEnabled,
        writeBuiltinEnabled,
        isOverrideConfirmed,
        writeOverrideApproval,
        confirmOverride,
        confirmClearSourceData,
        confirmCommunityMods,
        isRangeOverrideConfirmed,
        writeRangeOverride,
        confirmRangeOverride,
        confirmUninstall,
    };
};

module.exports = { createModApproval, TRUST_DIALOG_LOCALE };
