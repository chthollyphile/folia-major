import type { LibraryHiddenScope } from '../directory/directory.contract';
import type { LibraryHomeTabKey } from './homeModel.contract';
import { resolveHomeDirectoryKey, resolveHomeHiddenScope } from './homeSources';
import { localHomeSectionOfRow } from './localHomeModel';
import { useNavidromeHomeSectionStore } from './navidrome/useNavidromeHomeSectionStore';

// src/library/core/home/useLibraryHomeDirectory.ts
// 首页当前列表是哪个目录：目录会话 key 与隐藏作用域（规则在 core/home/homeSources）。本地 section 来自应用的
// 本地导航状态（activeRow），Navidrome section 来自它的 store。首页只在这里算一次，交给三个列表视图。

export const useLibraryHomeDirectory = ({
    tab,
    providerId,
    localRow,
}: {
    tab: LibraryHomeTabKey;
    providerId: string;
    localRow: number;
}): { directoryKey: string; hiddenScope: LibraryHiddenScope } => {
    const navidromeSection = useNavidromeHomeSectionStore(state => state.section);
    return {
        directoryKey: resolveHomeDirectoryKey({
            tab,
            providerId,
            localSection: localHomeSectionOfRow(localRow).key,
            navidromeSection,
        }),
        hiddenScope: resolveHomeHiddenScope(tab, providerId),
    };
};
