import { create } from 'zustand';

// src/library/core/home/foliaHomeSection.ts
// 首页 Folia 组的二级页签：歌单（聚合歌单）与标签（速记簿「时刻」里打的标签，一个标签一张卡）。
// 网格与 Bravais 共用这一个选择（换样式不丢）；只在这次运行里记着，重开回到歌单。

export type FoliaHomeSection = 'playlists' | 'tags';

export const FOLIA_HOME_SECTIONS: readonly { key: FoliaHomeSection; labelKey: string }[] = [
    { key: 'playlists', labelKey: 'home.foliaSectionPlaylists' },
    { key: 'tags', labelKey: 'home.foliaSectionTags' },
];

export const isFoliaHomeSection = (value: string): value is FoliaHomeSection => value === 'playlists' || value === 'tags';

type FoliaHomeSectionState = {
    section: FoliaHomeSection;
    setSection: (section: FoliaHomeSection) => void;
};

export const useFoliaHomeSectionStore = create<FoliaHomeSectionState>(set => ({
    section: 'playlists',
    setSection: section => set({ section }),
}));
