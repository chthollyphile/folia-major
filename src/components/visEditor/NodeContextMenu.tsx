import type { AddComplexNodeRequest } from './flowModel';
import type { NodePaletteGroup } from './nodePalette';

// src/components/visEditor/NodeContextMenu.tsx
// Context menu for creating graph nodes at the pointer location.
interface NodeContextMenuProps {
    x: number;
    y: number;
    groups: NodePaletteGroup[];
    onAddNode: (request: AddComplexNodeRequest) => void;
}

export const NodeContextMenu = ({ x, y, groups, onAddNode }: NodeContextMenuProps) => (
    <div
        className="vis-editor-context-menu"
        style={{ left: x, top: y }}
        onContextMenu={event => event.preventDefault()}
    >
        <div className="vis-editor-context-menu__title">添加节点</div>
        {groups.map(group => (
            <section key={group.title} className="vis-editor-context-menu__group">
                <div className="vis-editor-context-menu__group-title">{group.title}</div>
                <div className="vis-editor-context-menu__items">
                    {group.items.map(item => (
                        <button
                            key={`${item.role}-${'kind' in item ? item.kind : item.mode}`}
                            type="button"
                            onClick={() => onAddNode(item)}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </section>
        ))}
    </div>
);
