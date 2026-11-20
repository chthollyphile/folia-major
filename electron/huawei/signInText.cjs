// Native login-window text follows the application's language, including Traditional Chinese.
const LOGIN_TEXT = {
    'zh-CN': { title: '华为音乐登录', closed: '登录窗口已关闭', loadFailed: '登录页面打不开', account: '华为音乐账号' },
    'zh-TW': { title: '華為音樂登入', closed: '登入視窗已關閉', loadFailed: '登入頁面打不開', account: '華為音樂帳號' },
    en: { title: 'Sign in to Huawei Music', closed: 'The sign-in window was closed', loadFailed: 'The sign-in page could not be opened', account: 'Huawei Music account' },
    in: { title: 'Masuk ke Huawei Music', closed: 'Jendela masuk telah ditutup', loadFailed: 'Halaman masuk tidak dapat dibuka', account: 'Akun Huawei Music' },
    vi: { title: 'Đăng nhập Huawei Music', closed: 'Cửa sổ đăng nhập đã đóng', loadFailed: 'Không thể mở trang đăng nhập', account: 'Tài khoản Huawei Music' },
};

const loginText = language => LOGIN_TEXT[language] || LOGIN_TEXT.en;
const loginLocale = language => ({ 'zh-CN': 'zh-cn', 'zh-TW': 'zh-tw', en: 'en', in: 'id', vi: 'vi' })[language] || 'en';

module.exports = { loginText, loginLocale };
