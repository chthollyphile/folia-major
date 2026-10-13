import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { QueueUiComponentView, QueueUiEntryContent } from '../../mods/folium/queueUi';
import { FoliumMountHost } from '../../mods/folium/FoliumMountHost';

// src/components/shared/QueueUiAdditions.tsx
// The host owns placement and event boundaries; the mod owns every element and style inside the shadow root.
const themeVars = {
    '--folium-bg': 'var(--bg-color)', '--folium-primary': 'var(--text-primary)',
    '--folium-secondary': 'var(--text-secondary)', '--folium-accent': 'var(--text-accent)',
} as CSSProperties;
function ComponentMount({ component, isDaylight }: { component: QueueUiComponentView; isDaylight: boolean }) {
    const { i18n } = useTranslation();
    const ctx = useMemo(() => Object.freeze({ ...component.context, locale: i18n.language, isDaylight }),
        [component.context, i18n.language, isDaylight]);
    return <FoliumMountHost modId={component.modId} where={`queue component ${component.id}`}
        entryKind="queue-component" entryId={component.id} mount={component.mount} ctx={ctx} shadow fill={false}
        style={{ ...themeVars, minWidth: 0, width: component.width ?? '100%', flex: component.width ? 'none' : '1 1 0%' }} />;
}
export function QueueUiComponents({ components, isDaylight = false, className = '' }: {
    components: readonly QueueUiComponentView[]; isDaylight?: boolean; className?: string;
}) {
    if (!components.length) return null;
    return <div data-folium-slot={`queue.${components[0].context.placement}`}
        className={`flex min-w-0 items-center gap-0.5 ${className}`}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}>
        {components.map(component => <ComponentMount key={component.id} component={component} isDaylight={isDaylight} />)}
    </div>;
}
export function QueueUiOverline({ content, isDaylight = false, className = '' }: {
    content: QueueUiEntryContent; isDaylight?: boolean; className?: string;
}) {
    if (!content.overlines.length) return null;
    return <QueueUiComponents components={content.overlines} isDaylight={isDaylight} className={`h-3 ${className}`} />;
}
