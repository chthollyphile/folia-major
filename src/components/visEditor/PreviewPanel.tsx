import type { ReactNode } from 'react';
import { Pause, Play, Sparkles } from 'lucide-react';

// src/components/visEditor/PreviewPanel.tsx
// Displays the live visualizer preview in the prototype-inspired stage frame.
interface PreviewPanelProps {
    preview?: ReactNode;
    isPlaying?: boolean;
    onTogglePlayback?: () => void;
}

export const PreviewPanel = ({ preview, isPlaying = true, onTogglePlayback }: PreviewPanelProps) => (
    <section className="vis-editor-preview" aria-label="实时预览">
        <div className="vis-editor-preview__controls">
            <div className="vis-editor-live-badge">
                <Sparkles size={14} />
                实时预览
                <span />
            </div>
            {onTogglePlayback ? (
                <button
                    type="button"
                    className="vis-editor-preview-toggle"
                    onClick={onTogglePlayback}
                    aria-label={isPlaying ? '暂停预览' : '播放预览'}
                >
                    {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                    {isPlaying ? '暂停' : '播放'}
                </button>
            ) : null}
        </div>
        <div className="vis-editor-preview__frame">
            {preview ?? <div className="vis-editor-empty">没有可用预览</div>}
        </div>
    </section>
);
