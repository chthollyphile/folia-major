import { GitBranch, Minus, Plus, Sparkles } from 'lucide-react';

// src/components/visEditor/FlowToolbar.tsx
// Small overlay controls for the visual flow panel.
interface FlowToolbarProps {
    zoomPercent: number;
    selectedEdgeId: string | null;
    onAutoLayout: () => void;
    onDeleteEdge: () => void;
}

export const FlowToolbar = ({ zoomPercent, selectedEdgeId, onAutoLayout, onDeleteEdge }: FlowToolbarProps) => (
    <div className="vis-editor-flow-toolbar">
        {selectedEdgeId ? (
            <button type="button" className="vis-editor-flow-toolbar__danger" onClick={onDeleteEdge}>
                删除连线
            </button>
        ) : null}
        <button type="button" onClick={onAutoLayout}>
            <Sparkles size={14} />
            自动布局
        </button>
        <div className="vis-editor-flow-toolbar__zoom" aria-label="缩放比例">
            <Minus size={13} />
            <span>{zoomPercent}%</span>
            <Plus size={13} />
        </div>
        <div className="vis-editor-flow-toolbar__hint">
            <GitBranch size={14} />
            右键添加节点
        </div>
    </div>
);
