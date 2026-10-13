import { useEffect, useState } from 'react';
import type { ProbeDefinition } from './definition';
import type { Theme } from '../../src/types';
import CommandPalette from '../../src/components/command-palette/CommandPalette';
import type { CommandPaletteCommand, CommandPaletteContext } from '../../src/components/command-palette/types';
import { QueueUiComponents } from '../../src/components/shared/QueueUiAdditions';
import { queueUiRegistry } from '../../src/mods/folium/queueUi';
import { useQueueUi } from '../../src/hooks/useQueueUi';
import { buttonMount } from '../folium/sample-queue-ui/components.mjs';

// dev/probes/queueUiHost.probe.tsx
// The real palette's global Enter handler must not take over a contributed button.
const emptyQueue = Object.freeze([]);
const noop = () => {};
let appendCall: (name: string) => void = noop;
function Body() {
    const { headerContent } = useQueueUi(emptyQueue, 'command');
    return <div className="p-8"><QueueUiComponents components={headerContent} /></div>;
}
const command: CommandPaletteCommand = {
    id: 'queue-ui-host', group: 'playback', title: 'Queue UI host', description: '', keywords: [], execute: () => true,
    surface: { load: async () => ({ default: Body }) },
};
function Probe() {
    const [calls, setCalls] = useState<string[]>([]);
    useEffect(() => {
        appendCall = name => setCalls(current => [...current, name]);
        const sync = buttonMount({ label: 'Fixture sync', run: () => appendCall('sync') });
        const vote = buttonMount({ label: 'Fixture vote', run: () => appendCall('vote') });
        const handle = queueUiRegistry.register('probe-queue-ui-host', {
            id: 'actions', getHeaderContent: () => [
                { id: 'sync', width: 60, mount: sync },
                { id: 'vote', width: 60, mount: vote },
            ],
        });
        return () => { handle.unregister(); appendCall = noop; };
    }, []);
    return <>
        <output data-host-calls={JSON.stringify(calls)} />
        <CommandPalette activeIndex={0} activePreview={null} activeCommand={command} availableCommands={[command]}
            context={{ scope: { kind: 'global' } } as unknown as CommandPaletteContext}
            theme={{ accentColor: '#b67de3', backgroundColor: '#18151d', primaryColor: '#eee8f4', secondaryColor: '#b7aec4' } as Theme}
            isDaylight={false} isComposing={false} isExecuting={false} isOpen
            matches={[]} pinnedCommands={[]} query="" onActiveCommandChange={noop} onActiveIndexChange={noop}
            onClose={noop} onCompositionEnd={noop} onCompositionStart={noop} onQueryChange={noop} onQueryCommit={noop}
            onExecuteActive={async () => { appendCall('native-play'); return true; }}
            onExecuteMatch={async () => true} onExecutePinnedCommand={async () => true} />
    </>;
}
const definition: ProbeDefinition = { id: 'queueUiHost', title: 'Queue UI · actual palette keyboard',
    description: 'Real global palette key handling with offline appended buttons; unused playback ports are absent.', Component: Probe };
export default definition;
