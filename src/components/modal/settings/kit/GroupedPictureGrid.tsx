import React, { useState } from 'react';
import { PictureGrid, type PictureGridProps } from './PictureGrid';
import { Segmented } from './Segmented';

// Category tabs retain PictureGrid's existing keyboard navigation, lazy previews and one selected tile.
export interface PictureGroup { id: string; label: string; description: string }
export function GroupedPictureGrid<T extends string>({ groups, ...props }: PictureGridProps<T> & { groups?: readonly PictureGroup[] }) {
    const [selection, setSelection] = useState<{ value: T; group: string } | null>(null);
    if (!groups?.length) return <PictureGrid {...props} />;
    const available = groups.filter(group => props.options.some(option => option.group === group.id));
    if (!available.length) return <PictureGrid {...props} />;
    const chosen = props.options.find(option => option.value === props.value)?.group;
    const requested = selection?.value === props.value ? selection.group : chosen;
    const active = available.find(group => group.id === requested) ?? available[0];
    return <div className="flex min-h-0 flex-col gap-2">
        <div className="px-3" role="group" aria-label={props.label}><Segmented value={active.id} options={available.map(group => ({ value: group.id, label: group.label }))}
            onChange={group => setSelection({ value: props.value, group })} /></div>
        <p className="px-3 text-xs text-[color:var(--st-t3)]">{active.description}</p>
        <PictureGrid {...props} key={active.id} options={props.options.filter(option => option.group === active.id)} />
    </div>;
}
