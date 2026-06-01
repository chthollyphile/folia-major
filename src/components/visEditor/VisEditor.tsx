import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import {
    applyNodeChanges,
    Background,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type NodeChange,
    type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './VisEditor.css';
import { FlowToolbar } from './FlowToolbar';
import { Inspector } from './Inspector';
import { NodeContextMenu } from './NodeContextMenu';
import { PreviewPanel } from './PreviewPanel';
import { BackgroundNode, InputNode, MainRendererNode, OutputNode, OverlayNode } from './VisNode';
import {
    addComplexNode,
    applyFlowEdgeChanges,
    applyFlowNodeChanges,
    connectFlowNodes,
    layoutComplexNodes,
    reconnectFlowEdge,
    removeComplexEdge,
    toFlowEdges,
    toFlowNodes,
    updateComplexNodePosition,
    type AddComplexNodeRequest,
    type VisFlowEdge,
    type VisFlowNode,
} from './flowModel';
import { buildNodePaletteGroups } from './nodePalette';
import type { VisEditorProps } from './types';

// Full-screen visualizer complex editor composed from a graph canvas, preview, and inspector.
const nodeTypes: NodeTypes = {
    inputNode: InputNode,
    backgroundNode: BackgroundNode,
    mainRendererNode: MainRendererNode,
    overlayNode: OverlayNode,
    outputNode: OutputNode,
};

const hasRemovedNodeChange = (changes: NodeChange<VisFlowNode>[]) =>
    changes.some(change => change.type === 'remove');

const hasPersistedEdgeChange = (changes: EdgeChange<VisFlowEdge>[]) =>
    changes.some(change => change.type === 'remove');

interface ContextMenuState {
    x: number;
    y: number;
    flowPosition: { x: number; y: number; };
}

const VisEditorInner = ({
    complex,
    theme,
    isDaylight,
    onChange,
    onSave,
    onReset,
    onBack,
    preview,
    isPreviewPlaying = true,
    onTogglePreviewPlayback,
}: VisEditorProps) => {
    const flowWrapperRef = useRef<HTMLDivElement | null>(null);
    const isDraggingNodeRef = useRef(false);
    const { screenToFlowPosition } = useReactFlow();
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(complex.nodes[0]?.id ?? null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [activeLayer, setActiveLayer] = useState<'background' | 'lyrics' | 'overlay'>('lyrics');
    const [zoomPercent, setZoomPercent] = useState(100);
    const [flowNodes, setFlowNodes] = useState<VisFlowNode[]>(() => toFlowNodes(complex));
    const edges = useMemo(() => toFlowEdges(complex), [complex]);
    const paletteGroups = useMemo(() => buildNodePaletteGroups(), []);

    useEffect(() => {
        if (isDraggingNodeRef.current) {
            return;
        }

        setFlowNodes(toFlowNodes(complex));
    }, [complex]);

    const onNodesChange = useCallback((changes: NodeChange<VisFlowNode>[]) => {
        setFlowNodes(current => applyNodeChanges(changes, current));

        if (!hasRemovedNodeChange(changes)) {
            return;
        }

        const nextComplex = applyFlowNodeChanges(complex, changes);
        const stillSelected = selectedNodeId ? nextComplex.nodes.some(node => node.id === selectedNodeId) : false;
        if (!stillSelected) {
            setSelectedNodeId(nextComplex.nodes[0]?.id ?? null);
        }
        setSelectedEdgeId(null);
        setContextMenu(null);
        onChange(nextComplex);
    }, [complex, onChange, selectedNodeId]);

    const onNodeDragStart = useCallback(() => {
        isDraggingNodeRef.current = true;
        setContextMenu(null);
    }, []);

    const onNodeDragStop = useCallback((_: MouseEvent, node: VisFlowNode) => {
        isDraggingNodeRef.current = false;
        onChange(updateComplexNodePosition(complex, node.id, node.position));
    }, [complex, onChange]);

    const onEdgesChange = useCallback((changes: EdgeChange<VisFlowEdge>[]) => {
        if (!hasPersistedEdgeChange(changes)) {
            return;
        }

        const nextComplex = applyFlowEdgeChanges(complex, changes);
        const stillSelected = selectedEdgeId ? nextComplex.edges.some(edge => edge.id === selectedEdgeId) : false;
        if (!stillSelected) {
            setSelectedEdgeId(null);
        }
        onChange(nextComplex);
    }, [complex, onChange, selectedEdgeId]);

    const onConnect = useCallback((connection: Connection) => {
        setContextMenu(null);
        onChange(connectFlowNodes(complex, connection));
    }, [complex, onChange]);

    const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
        setContextMenu(null);
        onChange(reconnectFlowEdge(complex, oldEdge, connection));
    }, [complex, onChange]);

    const addNode = useCallback((request: AddComplexNodeRequest) => {
        const result = addComplexNode(complex, {
            ...request,
            position: contextMenu?.flowPosition,
        });
        setSelectedNodeId(result.nodeId);
        setSelectedEdgeId(null);
        setContextMenu(null);
        onChange(result.complex);
    }, [complex, contextMenu, onChange]);

    const deleteSelectedEdge = useCallback(() => {
        if (!selectedEdgeId) {
            return;
        }

        onChange(removeComplexEdge(complex, selectedEdgeId));
        setSelectedEdgeId(null);
    }, [complex, onChange, selectedEdgeId]);

    const onEdgeClick = useCallback((_: MouseEvent, edge: Edge) => {
        setSelectedEdgeId(edge.id);
        setSelectedNodeId(null);
        setContextMenu(null);
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setContextMenu(null);
    }, []);

    const openContextMenu = useCallback((event: MouseEvent) => {
        event.preventDefault();
        const bounds = flowWrapperRef.current?.getBoundingClientRect();
        setContextMenu({
            x: bounds ? event.clientX - bounds.left : event.clientX,
            y: bounds ? event.clientY - bounds.top : event.clientY,
            flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        });
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
    }, [screenToFlowPosition]);

    const onAutoLayout = useCallback(() => {
        setContextMenu(null);
        onChange(layoutComplexNodes(complex));
    }, [complex, onChange]);

    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
            event.preventDefault();
            deleteSelectedEdge();
        }
        if (event.key === 'Escape') {
            setContextMenu(null);
        }
    }, [deleteSelectedEdge, selectedEdgeId]);

    return (
        <div
            className={`vis-editor ${isDaylight ? 'vis-editor--daylight' : 'vis-editor--night'}`}
            style={{
                '--vis-editor-bg': theme.backgroundColor,
                '--vis-editor-primary': theme.primaryColor,
                '--vis-editor-accent': theme.accentColor,
                '--vis-editor-secondary': theme.secondaryColor,
            } as CSSProperties}
            onKeyDown={onKeyDown}
            tabIndex={-1}
        >
            <header className="vis-editor__header">
                <div className="vis-editor__title-row">
                    {onBack ? <button type="button" className="vis-editor__round-button" onClick={onBack} aria-label="返回">‹</button> : null}
                    <h1>歌词样式</h1>
                </div>
                <div className="vis-editor__actions">
                    {onReset ? <button type="button" onClick={onReset}>默认</button> : null}
                    {onSave ? <button type="button" className="vis-editor__primary-action" onClick={onSave}>保存</button> : null}
                </div>
            </header>

            <main className="vis-editor__body">
                <section className="vis-editor__left">
                    <PreviewPanel
                        preview={preview}
                        isPlaying={isPreviewPlaying}
                        onTogglePlayback={onTogglePreviewPlayback}
                    />

                    <section className="vis-editor__canvas-card" aria-label="视觉流程">
                        <div className="vis-editor-flow-head">
                            <div>
                                <div className="vis-editor-panel-title">视觉流程</div>
                                <div className="vis-editor-layer-tabs" aria-label="流程层级">
                                    <button type="button" className={activeLayer === 'background' ? 'is-active' : ''} onClick={() => setActiveLayer('background')}>背景层</button>
                                    <button type="button" className={activeLayer === 'lyrics' ? 'is-active' : ''} onClick={() => setActiveLayer('lyrics')}>歌词层</button>
                                    <button type="button" className={activeLayer === 'overlay' ? 'is-active' : ''} onClick={() => setActiveLayer('overlay')}>装饰层</button>
                                </div>
                            </div>
                            <FlowToolbar
                                zoomPercent={zoomPercent}
                                selectedEdgeId={selectedEdgeId}
                                onAutoLayout={onAutoLayout}
                                onDeleteEdge={deleteSelectedEdge}
                            />
                        </div>

                        <div ref={flowWrapperRef} className="vis-editor__canvas" aria-label="Visualizer complex graph">
                            <ReactFlow
                                nodes={flowNodes}
                                edges={edges}
                                nodeTypes={nodeTypes}
                                onNodesChange={onNodesChange}
                                onNodeDragStart={onNodeDragStart}
                                onNodeDragStop={onNodeDragStop}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                onReconnect={onReconnect}
                                edgesReconnectable
                                onNodeClick={(_, node) => {
                                    setSelectedNodeId(node.id);
                                    setSelectedEdgeId(null);
                                    setContextMenu(null);
                                }}
                                onEdgeClick={onEdgeClick}
                                onPaneClick={clearSelection}
                                onPaneContextMenu={openContextMenu}
                                onMove={(_, viewport) => {
                                    const nextZoom = Math.round(viewport.zoom * 100);
                                    setZoomPercent(current => current === nextZoom ? current : nextZoom);
                                }}
                                deleteKeyCode={['Delete', 'Backspace']}
                                fitView
                                fitViewOptions={{ padding: 0.18 }}
                            >
                                <Background gap={24} size={1} />
                                <Controls />
                                <MiniMap pannable zoomable />
                            </ReactFlow>
                            {contextMenu ? (
                                <NodeContextMenu
                                    x={contextMenu.x}
                                    y={contextMenu.y}
                                    groups={paletteGroups}
                                    onAddNode={addNode}
                                />
                            ) : null}
                        </div>
                    </section>
                </section>

                <Inspector
                    complex={complex}
                    selectedNodeId={selectedNodeId}
                    theme={theme}
                    isDaylight={isDaylight}
                    onChange={onChange}
                />
            </main>
        </div>
    );
};

export const VisEditor = (props: VisEditorProps) => (
    <ReactFlowProvider>
        <VisEditorInner {...props} />
    </ReactFlowProvider>
);

export default VisEditor;
