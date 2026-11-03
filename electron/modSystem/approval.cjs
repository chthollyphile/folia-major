// electron/modSystem/approval.cjs
// Whether a mod may run. The user's approval of a mod is stored together with
// the digest of the files it was given for, and holds only while the files are
// those; the native dialog that asks for it, with its text in the four
// languages, is here too. Cut out of modSystem.cjs. How a digest and a
// signature are computed stays in modDigest.cjs and modSignature.cjs.

'use strict';

const path = require('path');
const { dialog } = require('electron');

const { shortDigest } = require('./modDigest.cjs');

// Native confirmation dialog copy. The main process cannot reach the renderer's
// i18n bundle, so the four shipped locales are mirrored here like main.cjs's
// own dialog strings.
const TRUST_DIALOG_LOCALE = {
    'zh-CN': {
        title: '启用模组',
        message: (name, id) => `确定要启用模组“${name}”（${id}）吗？`,
        risk: '模组是第三方代码，未经官方安全审计。一旦启用，它将以应用的完整权限运行：可读写本地文件、访问网络、读取或修改任意应用设置（包括 AI 服务地址与密钥），并可在界面中执行代码。请仅启用你信任来源的模组。',
        permissions: '声明的权限：',
        noPermissions: '声明的权限：无',
        platformRead: (platforms) => `以你的账号读取平台数据（实验接口 platform.raw）：${platforms}。模组会以你在 Folia 登录的账号读取这些平台上的数据，例如听歌记录。`,
        platformWrite: (platforms) => `以你的账号改动平台数据：${platforms}。模组还可以改动这些平台账号里的内容，例如点赞、歌单和关注。`,
        queueReplace: '替换播放队列（playback.queue）：模组可以一次换掉整个播放队列，并结束私人 FM。替换后 Folia 会提示是哪个模组换的；在队列再被改动之前，可以撤销回替换前的队列。',
        equalizerControl: '会改写你的音效设置（equalizer.control）：模组可以切换你的音效预设，或换上它自己的均衡器曲线。你的自定义音效不会被覆盖，在音频效果器里随时可以换回。',
        renderQuality: '会改写歌词画布的渲染质量（visualizer.renderQuality）：模组可以修改「性能与动效」里的歌词画布分辨率与抗锯齿，用 canvas / WebGL 画的歌词样式会跟着变。各样式自己单独指定的设置不受影响，在「性能与动效」里随时可以改回。',
        visualizerMode: '会切换你的歌词动画样式（visualizer.mode）：模组可以替你换歌词样式，和你在播放页切换一样（「每首歌随机歌词动画」也会随之关掉）。在播放页随时可以换回。',
        visualizerTuning: '会改写歌词样式的设置（visualizer.tuning）：模组可以修改内置歌词样式自己的选项，例如镜头、动效和装饰。分辨率等画质设置不受影响，在样式设置里随时可以改回。',
        visualizerBeatEffects: '会改写智能动感模式的动感效果（visualizer.beatEffects）：模组可以开关各歌词样式的动感效果、调整强度。智能动感模式本身（关闭 / 只用已分析 / 开启）始终由你决定；但在「开启」下，模组打开的效果会让 GPU 为没分析过的歌做相应的分析（按鼓点的效果要分离鼓声）。',
        location: '安装位置：',
        fingerprint: '内容指纹：',
        client: '界面代码：',
        noClient: '界面代码：无',
        experimental: '选用的实验接口：',
        embedOrigins: '可嵌入的外部网页：',
        folia: '需要的 Folia 版本：',
        verifiedRisk: '此模组带有有效的 Folium 官方签名，来源与内容已经过官方审查，且签名后未被修改。启用后它仍以应用的完整权限运行：可读写本地文件、访问网络、读取或修改任意应用设置（包括 AI 服务地址与密钥），并可在界面中执行代码。',
        signatureVerified: (key) => `签名：官方认证（${key}）`,
        betaRisk: '此模组是 Folium 先行测试版本：仅通过了安全审查，不保证功能实现的整洁，甚至功能可能完全无法工作，主要供社区开发者做创意实验，普通用户请勿轻易启用。启用后它仍以应用的完整权限运行：可读写本地文件、访问网络、读取或修改任意应用设置（包括 AI 服务地址与密钥），并可在界面中执行代码。',
        signatureBeta: (key) => `签名：先行测试（${key}）`,
        signatureUnsigned: '签名：无（未经官方审查的第三方模组）',
        signatureInvalid: (reason) => `签名：不匹配（${reason}）。模组内容在签名后被修改，或签名无效，这份签名不能作为审查依据。`,
        rebind: '本次确认仅对当前文件内容生效；模组文件发生变化后需要重新确认。',
        devSource: '开发模式：这个模组位于源码目录的 mods/ 中，确认后修改它的文件不会撤销本次确认。安装版和用户模组目录中的模组没有这项豁免。',
        enable: '仍要启用',
        cancel: '取消',
    },
    'zh-TW': {
        title: '啟用模組',
        message: (name, id) => `確定要啟用模組“${name}”（${id}）嗎？`,
        risk: '模組是第三方程式碼，未經官方安全審計。一旦啟用，它將以應用的完整權限執行：可讀寫本地檔案、存取網路、讀取或修改任意應用設定（包括 AI 服務位址與金鑰），並可在介面中執行程式碼。請僅啟用你信任來源的模組。',
        permissions: '宣告的權限：',
        noPermissions: '宣告的權限：無',
        platformRead: (platforms) => `以你的帳號讀取平臺數據（實驗介面 platform.raw）：${platforms}。模組會以你在 Folia 登入的帳號讀取這些平臺上的資料，例如聽歌記錄。`,
        platformWrite: (platforms) => `以你的帳號改動平臺數據：${platforms}。模組還可以改動這些平臺帳號裡的內容，例如點贊、歌單和關注。`,
        queueReplace: '替換播放佇列（playback.queue）：模組可以一次換掉整個播放佇列，並結束私人 FM。替換後 Folia 會提示是哪個模組換的；在佇列再被改動之前，可以撤銷回替換前的佇列。',
        equalizerControl: '會改寫你的音效設定（equalizer.control）：模組可以切換你的音效預設，或換上它自己的等化器曲線。你的自定義音效不會被覆蓋，在音訊效果器裡隨時可以換回。',
        renderQuality: '會改寫歌詞畫布的渲染質量（visualizer.renderQuality）：模組可以修改「效能與動效」裡的歌詞畫布解析度與抗鋸齒，用 canvas / WebGL 畫的歌詞樣式會跟著變。各樣式自己單獨指定的設定不受影響，在「效能與動效」裡隨時可以改回。',
        visualizerMode: '會切換你的歌詞動畫樣式（visualizer.mode）：模組可以替你換歌詞樣式，和你在播放頁切換一樣（「每首歌隨機歌詞動畫」也會隨之關掉）。在播放頁隨時可以換回。',
        visualizerTuning: '會改寫歌詞樣式的設定（visualizer.tuning）：模組可以修改內建歌詞樣式自己的選項，例如鏡頭、動效和裝飾。解析度等畫質設定不受影響，在樣式設定裡隨時可以改回。',
        visualizerBeatEffects: '會改寫智慧動感模式的動感效果（visualizer.beatEffects）：模組可以開關各歌詞樣式的動感效果、調整強度。智慧動感模式本身（關閉 / 只用已分析 / 開啟）始終由你決定；但在「開啟」下，模組開啟的效果會讓 GPU 為沒分析過的歌做相應的分析（按鼓點的效果要分離鼓聲）。',
        location: '安裝位置：',
        fingerprint: '內容指紋：',
        client: '介面程式碼：',
        noClient: '介面程式碼：無',
        experimental: '選用的實驗介面：',
        embedOrigins: '可嵌入的外部網頁：',
        folia: '需要的 Folia 版本：',
        verifiedRisk: '此模組帶有有效的 Folium 官方簽名，來源與內容已經過官方審查，且簽名後未被修改。啟用後它仍以應用的完整權限執行：可讀寫本地檔案、存取網路、讀取或修改任意應用設定（包括 AI 服務位址與金鑰），並可在介面中執行程式碼。',
        signatureVerified: (key) => `簽名：官方認證（${key}）`,
        betaRisk: '此模組是 Folium 先行測試版本：僅通過了安全審查，不保證功能實現的整潔，甚至功能可能完全無法工作，主要供社群開發者做創意實驗，普通使用者請勿輕易啟用。啟用後它仍以應用的完整權限執行：可讀寫本地檔案、存取網路、讀取或修改任意應用設定（包括 AI 服務位址與金鑰），並可在介面中執行程式碼。',
        signatureBeta: (key) => `簽名：先行測試（${key}）`,
        signatureUnsigned: '簽名：無（未經官方審查的第三方模組）',
        signatureInvalid: (reason) => `簽名：不匹配（${reason}）。模組內容在簽名後被修改，或簽名無效，這份簽名不能作為審查依據。`,
        rebind: '本次確認僅對當前檔案內容生效；模組檔案發生變化後需要重新確認。',
        devSource: '開發模式：這個模組位於原始碼目錄的 mods/ 中，確認後修改它的檔案不會撤銷本次確認。安裝版和使用者模組目錄中的模組沒有這項豁免。',
        enable: '仍要啟用',
        cancel: '取消',
    },
    en: {
        title: 'Enable mod',
        message: (name, id) => `Enable the mod "${name}" (${id})?`,
        risk: 'Mods are third-party code and are not security-audited. Once enabled, a mod runs with the full privileges of the app: it can read and write local files, access the network, read or change any app setting (including the AI service URL and key), and run code inside the UI. Only enable mods from sources you trust.',
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
        location: 'Installed at: ',
        fingerprint: 'Content fingerprint: ',
        client: 'UI code: ',
        noClient: 'UI code: none',
        experimental: 'Experimental APIs opted into: ',
        embedOrigins: 'External pages it may embed: ',
        folia: 'Needs Folia ',
        verifiedRisk: 'This mod carries a valid official Folium signature: its source and content were reviewed by Folium and have not changed since signing. Once enabled it still runs with the full privileges of the app: it can read and write local files, access the network, read or change any app setting (including the AI service URL and key), and run code inside the UI.',
        signatureVerified: (key) => `Signature: officially verified (${key})`,
        betaRisk: 'This mod is a Folium preview build: it passed the security review only. Its implementation may be rough and its features may not work at all; it is meant for community developers to experiment with, and most users should not enable it. Once enabled it still runs with the full privileges of the app: it can read and write local files, access the network, read or change any app setting (including the AI service URL and key), and run code inside the UI.',
        signatureBeta: (key) => `Signature: preview build (${key})`,
        signatureUnsigned: 'Signature: none (a third-party mod not reviewed by Folium)',
        signatureInvalid: (reason) => `Signature: does not match (${reason}). The mod was changed after signing, or the signature is invalid; the signature can no longer vouch for it.`,
        rebind: 'This confirmation applies to the current files only; the mod must be confirmed again after its code changes.',
        devSource: 'Development mode: this mod is in the source tree\'s mods/ directory, so editing its files after this confirmation does not revoke it. Installed builds and the user mods directory have no such exemption.',
        enable: 'Enable anyway',
        cancel: 'Cancel',
    },
    in: {
        title: 'Aktifkan mod',
        message: (name, id) => `Aktifkan mod "${name}" (${id})?`,
        risk: 'Mod adalah kode pihak ketiga dan tidak diaudit keamanannya. Setelah diaktifkan, mod berjalan dengan hak penuh aplikasi: dapat membaca dan menulis berkas lokal, mengakses jaringan, membaca atau mengubah pengaturan apa pun (termasuk URL dan kunci layanan AI), serta menjalankan kode di dalam antarmuka. Aktifkan hanya mod dari sumber yang Anda percayai.',
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
        location: 'Terpasang di: ',
        fingerprint: 'Sidik konten: ',
        client: 'Kode antarmuka: ',
        noClient: 'Kode antarmuka: tidak ada',
        experimental: 'API eksperimental yang dipakai: ',
        embedOrigins: 'Halaman eksternal yang dapat disematkan: ',
        folia: 'Membutuhkan Folia ',
        verifiedRisk: 'Mod ini memiliki tanda tangan resmi Folium yang valid: sumber dan isinya telah ditinjau oleh Folium dan tidak berubah sejak ditandatangani. Setelah diaktifkan, mod tetap berjalan dengan hak penuh aplikasi: dapat membaca dan menulis berkas lokal, mengakses jaringan, membaca atau mengubah pengaturan apa pun (termasuk URL dan kunci layanan AI), serta menjalankan kode di dalam antarmuka.',
        signatureVerified: (key) => `Tanda tangan: terverifikasi resmi (${key})`,
        betaRisk: 'Mod ini adalah versi pratinjau Folium: hanya lolos tinjauan keamanan. Implementasinya mungkin belum rapi dan fiturnya bisa saja sama sekali tidak berfungsi; mod ini ditujukan bagi pengembang komunitas untuk bereksperimen, dan sebagian besar pengguna sebaiknya tidak mengaktifkannya. Setelah diaktifkan, mod tetap berjalan dengan hak penuh aplikasi: dapat membaca dan menulis berkas lokal, mengakses jaringan, membaca atau mengubah pengaturan apa pun (termasuk URL dan kunci layanan AI), serta menjalankan kode di dalam antarmuka.',
        signatureBeta: (key) => `Tanda tangan: versi pratinjau (${key})`,
        signatureUnsigned: 'Tanda tangan: tidak ada (mod pihak ketiga yang belum ditinjau Folium)',
        signatureInvalid: (reason) => `Tanda tangan: tidak cocok (${reason}). Mod diubah setelah ditandatangani, atau tanda tangannya tidak valid; tanda tangan ini tidak lagi bisa menjaminnya.`,
        rebind: 'Konfirmasi ini hanya berlaku untuk berkas saat ini; mod harus dikonfirmasi ulang setelah kodenya berubah.',
        devSource: 'Mode pengembangan: mod ini ada di direktori mods/ pada kode sumber, jadi mengubah berkasnya setelah konfirmasi ini tidak membatalkannya. Build terpasang dan direktori mod pengguna tidak mendapat pengecualian ini.',
        enable: 'Tetap aktifkan',
        cancel: 'Batal',
    },
    vi: {
        title: 'Bật mod',
        message: (name, id) => `Bạn có chắc chắn muốn bật mod “${name}” (${id}) không?`,
        risk: 'Mod là mã nguồn từ bên thứ ba và chưa được kiểm tra an toàn chính thức. Khi được bật, mod sẽ chạy với toàn bộ quyền hạn của ứng dụng: có thể đọc và ghi tệp cục bộ, truy cập mạng, đọc hoặc thay đổi bất kỳ cài đặt nào của ứng dụng (bao gồm địa chỉ và khóa dịch vụ AI), và thực thi mã trong giao diện. Chỉ bật các mod từ nguồn mà bạn tin cậy.',
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
        location: 'Vị trí cài đặt: ',
        fingerprint: 'Mã định danh nội dung: ',
        client: 'Mã giao diện: ',
        noClient: 'Mã giao diện: không có',
        experimental: 'Giao diện thử nghiệm tùy chọn: ',
        embedOrigins: 'Trang web bên ngoài có thể nhúng: ',
        folia: 'Yêu cầu phiên bản Folia ',
        verifiedRisk: 'Mod này có chữ ký chính thức hợp lệ của Folium: nguồn và nội dung đã được Folium xem xét và không bị chỉnh sửa kể từ khi ký. Sau khi bật, mod vẫn chạy với toàn bộ quyền hạn của ứng dụng: có thể đọc và ghi tệp cục bộ, truy cập mạng, đọc hoặc thay đổi bất kỳ cài đặt nào của ứng dụng (bao gồm địa chỉ và khóa dịch vụ AI), và thực thi mã trong giao diện.',
        signatureVerified: (key) => `Chữ ký: Chứng nhận chính thức (${key})`,
        betaRisk: 'Mod này là bản thử nghiệm sớm của Folium: chỉ mới vượt qua kiểm tra an toàn, không đảm bảo tính ổn định và thậm chí có thể không hoạt động; chủ yếu dành cho nhà phát triển cộng đồng thử nghiệm, người dùng thông thường không nên bật. Sau khi bật, mod vẫn chạy với toàn bộ quyền hạn của ứng dụng: có thể đọc và ghi tệp cục bộ, truy cập mạng, đọc hoặc thay đổi bất kỳ cài đặt nào của ứng dụng (bao gồm địa chỉ và khóa dịch vụ AI), và thực thi mã trong giao diện.',
        signatureBeta: (key) => `Chữ ký: Thử nghiệm sớm (${key})`,
        signatureUnsigned: 'Chữ ký: Không có (mod bên thứ ba chưa được Folium xem xét)',
        signatureInvalid: (reason) => `Chữ ký: Không khớp (${reason}). Nội dung mod đã bị sửa đổi sau khi ký hoặc chữ ký không hợp lệ; chữ ký này không còn giá trị chứng nhận.`,
        rebind: 'Xác nhận này chỉ có hiệu lực với nội dung tệp hiện tại; bạn sẽ cần xác nhận lại nếu mã mod bị thay đổi.',
        devSource: 'Chế độ phát triển: Mod này nằm trong thư mục mods/ của mã nguồn, do đó chỉnh sửa tệp sau khi xác nhận sẽ không hủy bỏ xác nhận này. Bản cài đặt và thư mục mod người dùng không được miễn trừ.',
        enable: 'Vẫn bật',
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
    const confirmEnableMod = async (runtime, digest, signature) => {
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
            client ? `${locale.client}${client}` : locale.noClient,
            ...(experimental.length > 0 ? [`${locale.experimental}${experimental.join(', ')}`] : []),
            ...(embedOrigins.length > 0 ? [`${locale.embedOrigins}${embedOrigins.join(', ')}`] : []),
            ...(folia ? [`${locale.folia}${folia}`] : []),
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

    return { writeTrust, isDevSourceMod, resolveTrust, confirmEnableMod };
};

module.exports = { createModApproval, TRUST_DIALOG_LOCALE };
