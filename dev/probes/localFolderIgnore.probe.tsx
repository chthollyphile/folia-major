import { useState } from 'react';
import '../../src/i18n/config';
import GridMapBatchPanel from '../../src/library/suites/grid/directory/GridMapBatchPanel';
import { createLocalDirectoryActions } from '../../src/library/core/directory/localDirectoryActions.service';
import type { ProbeDefinition } from './definition';

// dev/probes/localFolderIgnore.probe.tsx

const noop = () => {};
const NO_SELECTION: ReadonlySet<string> = new Set();

function LocalFolderIgnoreProbe() {
    const [ignored, setIgnored] = useState(true);
    const [query, setQuery] = useState('');
    // 批量动作走真实的控制器，副作用端口是假的：恢复忽略目录就是把这一行的 ignored 关掉。
    const [controller] = useState(() => createLocalDirectoryActions({
        getLocalSongs: () => [],
        playLocalSongs: noop,
        enqueueLocalSongs: noop,
        createLocalPlaylist: noop,
        deleteFolderSongs: noop,
        deleteSongsByIds: noop,
        clearFolderIgnore: () => { setIgnored(false); },
        resyncFolder: noop,
        removeImportedRoot: noop,
        refreshLibrary: noop,
    }));
    return (
        <div className="h-[700px] w-[400px] p-6">
            <input aria-label="Search folders" value={query} onChange={event => setQuery(event.target.value)} />
            <GridMapBatchPanel
                title="Folders" context={{ items: [], trackIds: [] }} totalItemCount={0}
                searchQuery={query} displayItems={[]} selectedItemIds={NO_SELECTION} isDaylight
                onToggleSelectAll={noop} onSetItemsSelected={noop}
                isRemoveConfirmOpen={false} onRemoveConfirmOpenChange={noop}
                config={{
                    selectionType: 'folders',
                    directoryTrees: [{
                        id: 'Music', name: 'Music', path: 'Music', rootPath: 'Music', depth: 0,
                        directTrackCount: 0, totalTrackCount: 0,
                        children: [{
                            id: 'Music/Hidden', name: 'Hidden', path: 'Music/Hidden', rootPath: 'Music', depth: 1,
                            ignored, directTrackCount: 0, totalTrackCount: 0, children: [],
                        }],
                    }],
                    controller,
                }}
            />
        </div>
    );
}

export default {
    id: 'localFolderIgnore', title: 'Local folder ignore',
    description: 'Recover an ignored folder from an otherwise empty directory tree.',
    Component: LocalFolderIgnoreProbe,
} satisfies ProbeDefinition;
