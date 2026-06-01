import type { Theme } from '../../types';
import type { VisualizerComplexNode, VisualizerComplexV1 } from '../visualizer/complex';
import { getNodeTargetPorts, getPortLabel } from '../visualizer/portRegistry';
import { rebuildOutput } from './flowModel';
import { CheckboxField, FieldGroup, RangeField, renderMainModeControls } from './InspectorControls';

// src/components/visEditor/Inspector.tsx
// Right-side inspector for selecting and editing persisted complex nodes.
interface InspectorProps {
    complex: VisualizerComplexV1;
    selectedNodeId: string | null;
    theme: Theme;
    isDaylight: boolean;
    onChange: (complex: VisualizerComplexV1) => void;
}

const updateNode = (
    complex: VisualizerComplexV1,
    nodeId: string,
    updater: (node: VisualizerComplexNode) => VisualizerComplexNode,
) => {
    const nodes = complex.nodes.map(node => (node.id === nodeId ? updater(node) : node));
    return { ...complex, nodes, output: rebuildOutput(nodes, complex.edges) };
};

const hasOpacityConfig = (node: VisualizerComplexNode): node is Extract<VisualizerComplexNode, { config: { opacity?: number } }> =>
    'config' in node && 'opacity' in node.config;

const getInspectorTitle = (node: VisualizerComplexNode) => {
    if (node.role === 'visualizerMain') return '主歌词样式';
    if (node.role === 'visualizerBg') return '背景层参数';
    if (node.role === 'visualizerOverlay') return '装饰层参数';
    if (node.role === 'input') return '输入节点';
    return '输出节点';
};

const getInspectorDescription = (node: VisualizerComplexNode) => {
    if (node.role === 'visualizerMain') return '控制主歌词在画面中的字体与排版表现';
    if (node.role === 'visualizerBg') return '控制背景渲染、透明度和视觉层级';
    if (node.role === 'visualizerOverlay') return '控制字幕叠加、翻译和辅助信息';
    if (node.role === 'input') return '输入节点用于给视觉流程提供数据来源';
    return '输出节点汇总当前视觉流程';
};

export const Inspector = ({ complex, selectedNodeId, theme, isDaylight, onChange }: InspectorProps) => {
    const selectedNode = complex.nodes.find(node => node.id === selectedNodeId) ?? null;
    const nodesById = new Map(complex.nodes.map(node => [node.id, node]));

    if (!selectedNode) {
        return (
            <aside className="vis-editor-inspector" style={{ borderColor: `${theme.accentColor}33` }}>
                <div className="vis-editor-panel-title">参数面板</div>
                <div className="vis-editor-empty">选择一个节点来编辑视觉参数</div>
            </aside>
        );
    }

    const setNode = (updater: (node: VisualizerComplexNode) => VisualizerComplexNode) => {
        onChange(updateNode(complex, selectedNode.id, updater));
    };

    return (
        <aside className="vis-editor-inspector" style={{ borderColor: `${theme.accentColor}33` }}>
            <div className="vis-editor-inspector__head">
                <h2>{getInspectorTitle(selectedNode)}</h2>
                <p>{getInspectorDescription(selectedNode)}</p>
            </div>
            <div className="vis-editor-inspector__id">{selectedNode.id}</div>

            <label className="vis-editor-field">
                <span>节点名称</span>
                <input value={selectedNode.label} onChange={event => setNode(node => ({ ...node, label: event.target.value }))} />
            </label>

            <CheckboxField label="启用节点" checked={selectedNode.enabled} onChange={checked => setNode(node => ({ ...node, enabled: checked }))} />

            <div className="vis-editor-readonly-grid">
                <span>角色</span>
                <strong>{selectedNode.role}</strong>
                <span>类型</span>
                <strong>{selectedNode.kind}</strong>
            </div>

            {getNodeTargetPorts(selectedNode).length > 0 ? (
                <FieldGroup title="端口连接">
                    <div className="vis-editor-port-bindings">
                        {getNodeTargetPorts(selectedNode).map(port => {
                            const incoming = complex.edges.find(edge => edge.target === selectedNode.id && edge.targetHandle === port.id);
                            const sourceNode = incoming ? nodesById.get(incoming.source) : undefined;
                            return (
                                <div key={port.id} className="vis-editor-port-binding">
                                    <span>{port.label}</span>
                                    <strong>
                                        {incoming && sourceNode
                                            ? `${sourceNode.label} / ${getPortLabel(sourceNode, incoming.sourceHandle, 'source')}`
                                            : '使用默认值'}
                                    </strong>
                                </div>
                            );
                        })}
                    </div>
                </FieldGroup>
            ) : null}

            {hasOpacityConfig(selectedNode) ? (
                <RangeField
                    label="透明度"
                    value={selectedNode.config.opacity ?? 1}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={value => setNode(node => {
                        if (node.role === 'visualizerBg' || node.role === 'visualizerMain' || node.role === 'visualizerOverlay') {
                            return { ...node, config: { ...node.config, opacity: value } };
                        }
                        return node;
                    })}
                />
            ) : null}

            {selectedNode.role === 'visualizerBg' && selectedNode.kind === 'coverFluid' ? (
                <CheckboxField
                    label="使用封面色彩"
                    checked={selectedNode.config.useCoverColor ?? true}
                    onChange={checked => setNode(node => node.role === 'visualizerBg' ? { ...node, config: { ...node.config, useCoverColor: checked } } : node)}
                />
            ) : null}

            {selectedNode.role === 'visualizerBg' && selectedNode.kind === 'geometric' ? (
                <CheckboxField
                    label="隐藏几何图形"
                    checked={selectedNode.config.hideShapes ?? false}
                    onChange={checked => setNode(node => node.role === 'visualizerBg' ? { ...node, config: { ...node.config, hideShapes: checked } } : node)}
                />
            ) : null}

            {selectedNode.role === 'visualizerMain' ? renderMainModeControls(selectedNode, setNode) : null}

            {selectedNode.role === 'visualizerOverlay' ? (
                <FieldGroup title="字幕叠加">
                    <CheckboxField label="隐藏翻译" checked={selectedNode.config.hideTranslation ?? false} onChange={checked => setNode(node => node.role === 'visualizerOverlay' ? { ...node, config: { ...node.config, hideTranslation: checked } } : node)} />
                    <RangeField label="翻译字号" value={selectedNode.config.translationFontSizeRem ?? 1.1} min={0.7} max={1.8} step={0.01} onChange={value => setNode(node => node.role === 'visualizerOverlay' ? { ...node, config: { ...node.config, translationFontSizeRem: value } } : node)} />
                    <RangeField label="预告字号" value={selectedNode.config.upcomingFontSizeRem ?? 0.95} min={0.6} max={1.4} step={0.01} onChange={value => setNode(node => node.role === 'visualizerOverlay' ? { ...node, config: { ...node.config, upcomingFontSizeRem: value } } : node)} />
                </FieldGroup>
            ) : null}

            {selectedNode.role === 'visualizerMain' && complex.output.mainNodeIds.length > 1 ? (
                <div className="vis-editor-inspector__hint">多个主渲染器已启用，会按输出顺序叠加透明度与 GPU 开销。</div>
            ) : (
                <div className="vis-editor-inspector__hint">
                    {isDaylight ? '当前使用浅色预览主题。' : '当前使用深色预览主题。'}
                </div>
            )}
        </aside>
    );
};
