import { openOutsideLink } from '../../utils/system/outsideLink';

// src/components/shared/discordCommunity.ts
// 官方 Discord 社区入口。链接只在这里声明一份，帮助页和「遇到问题？」弹窗共用。

export const DISCORD_INVITE_URL = 'https://discord.com/invite/dMDBTHxeKd';

// Electron 里 <a target="_blank"> 会开一个新的 BrowserWindow，必须走主进程交给系统浏览器。
export const openDiscordInvite = () => {
    void openOutsideLink(DISCORD_INVITE_URL);
};
