import { defineCommand } from '../commandFactories';
import { canPositionNowPlayingCard, useNowPlayingCardLayoutStore } from '../../app/overlays/now-playing-toast/nowPlayingCardLayoutStore';

// One action shared by the settings button and palette; it needs an actual display song.
export const nowPlayingCardPositionCommand = defineCommand({
    id: 'settings-now-playing-card-position',
    group: 'settings',
    title: 'Reposition song card',
    description: 'Drag the now playing card to a new position',
    keywords: ['move track toast', 'card placement', '歌曲卡片位置', '移动卡片'],
    isAvailable: canPositionNowPlayingCard,
    execute: () => {
        if (!canPositionNowPlayingCard()) return false;
        useNowPlayingCardLayoutStore.getState().requestPositioning();
        return true;
    },
});
