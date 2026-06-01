import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, Layers, Play, Sparkles, Type } from 'lucide-react';
import type { FlowNodeData, VisFlowNode } from './flowModel';
import type { VisualizerPortDefinition } from '../visualizer/portRegistry';

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

const renderPorts = (
    ports: VisualizerPortDefinition[],
    type: 'source' | 'target',
) => ports.map((port, index) => {
    const top = `${((index + 1) / (ports.length + 1)) * 100}%`;
    const isSource = type === 'source';

    return (
        <div key={port.id} className={`vis-editor-node__port vis-editor-node__port--${type}`}>
            <Handle
                id={port.id}
                type={type}
                position={isSource ? Position.Right : Position.Left}
                style={{ top }}
            />
            <span>{port.label}</span>
            <em>{port.dataType}</em>
        </div>
    );
});

export const VisNode = ({ data, selected }: NodeProps<VisFlowNode>) => {
    const nodeData = data as FlowNodeData;
    const roleClassName = ROLE_CLASS_NAMES[nodeData.role] ?? 'vis-editor-node--input';
    const Icon = ROLE_ICONS[nodeData.role] ?? Box;

    return (
        <div className={`vis-editor-node ${roleClassName} ${selected ? 'vis-editor-node--selected' : ''}`}>
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
            {acceptsInput(nodeData.role) && nodeData.targetPorts.length > 0 ? (
                <div className="vis-editor-node__ports vis-editor-node__ports--target">
                    {renderPorts(nodeData.targetPorts, 'target')}
                </div>
            ) : null}
            {emitsOutput(nodeData.role) && nodeData.sourcePorts.length > 0 ? (
                <div className="vis-editor-node__ports vis-editor-node__ports--source">
                    {renderPorts(nodeData.sourcePorts, 'source')}
                </div>
            ) : null}
        </div>
    );
};

export const InputNode = VisNode;
export const BackgroundNode = VisNode;
export const MainRendererNode = VisNode;
export const OverlayNode = VisNode;
export const OutputNode = VisNode;
