import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, Layers, Play, Sparkles, Type } from 'lucide-react';
import type { FlowNodeData, VisFlowNode } from './flowModel';

// Shared React Flow node view for all visualizer complex roles.
const ROLE_LABELS: Record<string, string> = {
    input: '输入',
    visualizerBg: '背景层',
    visualizerMain: '歌词层',
    visualizerOverlay: '装饰层',
    output: '输出',
};

const ROLE_CLASS_NAMES: Record<string, string> = {
    input: 'vis-editor-node--input',
    visualizerBg: 'vis-editor-node--background',
    visualizerMain: 'vis-editor-node--main',
    visualizerOverlay: 'vis-editor-node--overlay',
    output: 'vis-editor-node--output',
};

const acceptsInput = (role: string) => role !== 'input';
const emitsOutput = (role: string) => role !== 'output';

const ROLE_ICONS = {
    input: Box,
    visualizerBg: Layers,
    visualizerMain: Type,
    visualizerOverlay: Sparkles,
    output: Play,
};

export const VisNode = ({ data, selected }: NodeProps<VisFlowNode>) => {
    const nodeData = data as FlowNodeData;
    const roleClassName = ROLE_CLASS_NAMES[nodeData.role] ?? 'vis-editor-node--input';
    const Icon = ROLE_ICONS[nodeData.role] ?? Box;

    return (
        <div className={`vis-editor-node ${roleClassName} ${selected ? 'vis-editor-node--selected' : ''}`}>
            {acceptsInput(nodeData.role) ? <Handle type="target" position={Position.Left} /> : null}
            <div className="vis-editor-node__head">
                <div className="vis-editor-node__icon"><Icon size={16} /></div>
                <div>
                    <div className="vis-editor-node__label">{nodeData.label}</div>
                    <div className="vis-editor-node__meta">
                        <span className={nodeData.enabled ? 'vis-editor-node__dot' : 'vis-editor-node__dot vis-editor-node__dot--off'} />
                        {nodeData.enabled ? '启用' : '停用'}
                    </div>
                </div>
            </div>
            <div className="vis-editor-node__role">{ROLE_LABELS[nodeData.role] ?? nodeData.role}</div>
            <div className="vis-editor-node__summary">
                {nodeData.summary.slice(0, 3).map(item => <span key={item}>{item}</span>)}
            </div>
            {emitsOutput(nodeData.role) ? <Handle type="source" position={Position.Right} /> : null}
        </div>
    );
};

export const InputNode = VisNode;
export const BackgroundNode = VisNode;
export const MainRendererNode = VisNode;
export const OverlayNode = VisNode;
export const OutputNode = VisNode;
