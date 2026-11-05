import { defineCommand } from '../../commandFactories';
import { openLoginWindow } from '../../../login/loginWindowStore';

// The complete playback setup stays in the same login page, including executable and key actions.
export default defineCommand({
    id: 'spotify-playback-setup',
    group: 'settings',
    title: 'Spotify playback setup',
    description: 'Configure official Soloist, its API key, and device pairing',
    keywords: ['spotify', 'soloist', 'playback setup', 'connect', 'Spotify 播放设置', '密钥', '设备配对', '重新连接'],
    platform: ['electron'],
    execute: () => { openLoginWindow('spotify'); return true; },
});
