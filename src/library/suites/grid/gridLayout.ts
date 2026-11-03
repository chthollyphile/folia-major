import type { LibrarySuiteLayout } from '../../core/suite/suite.contract';
import { gridViewStateStorageKey } from './shared/gridViewRestore';
import { artistGridStateStorageKey } from './artist/ArtistGridView';

// src/library/suites/grid/gridLayout.ts
// 网格的布局记录：集合网格（folia_gridview_state:v2:<collectionKey>）与歌手页网格
// （folia_artist_grid_state:v2:<collectionKey>）在 sessionStorage 里各存一份相机位置与卡片下标。
// 「完成」（任意 suite 的返回按钮）时宿主经 manifest 的 layout.forget 让网格丢掉这一层的两份记录——
// 原来写在 GridView / ArtistGridView 的返回按钮里，P4.5 收到宿主（见 core/suite/suite.contract 的 LibrarySuiteLayout）。

export const gridLayout: LibrarySuiteLayout = {
    forget: (sessionKey) => {
        if (!sessionKey) return;
        try {
            sessionStorage.removeItem(gridViewStateStorageKey(sessionKey));
            sessionStorage.removeItem(artistGridStateStorageKey(sessionKey));
        } catch {
            // sessionStorage 不可用（隐私模式等）：本来也没有记录可忘。
        }
    },
};
