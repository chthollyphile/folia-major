import { useShallow } from 'zustand/react/shallow';
import { useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';

// src/components/visualizer/useVisualizerStyleAssets.ts
// The pictures a listener gave the lyric styles (群唱's emoji and avatars, 莫奈's portrait), under
// the names the renderer takes them by. Whoever draws a style from this app's stores (the playing
// page, the settings window's sample and its small pictures) spreads this onto the renderer's props.

export const useVisualizerStyleAssets = () => useVisualizerAssetStore(useShallow(state => ({
    cappellaCustomEmojiImages: state.cappellaCustomEmojiImages,
    cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
    monetPortraitImage: state.monetPortraitImage,
})));
