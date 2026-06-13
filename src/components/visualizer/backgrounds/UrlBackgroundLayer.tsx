import React, { useMemo, useState, useEffect, useRef } from 'react';
import type { UrlBackgroundItem } from '../../../types';

// src/components/visualizer/backgrounds/UrlBackgroundLayer.tsx
// Renders a webpage as background via iframe.
// Uses key={url} to force full iframe recreation on URL change,
// avoiding chrome-error://chromewebdata cross-origin navigation errors.
// Defers iframe creation until the container has valid layout dimensions,
// so that embedded scripts (canvas, WebGL, etc.) initialize with correct viewport size.

interface UrlBackgroundLayerProps {
    urlBackgroundList?: UrlBackgroundItem[];
    urlBackgroundSelectedId?: string | null;
}

const UrlBackgroundLayer: React.FC<UrlBackgroundLayerProps> = ({
    urlBackgroundList = [],
    urlBackgroundSelectedId = null,
}) => {
    const selectedItem = useMemo(
        () => urlBackgroundList.find(item => item.id === urlBackgroundSelectedId) ?? null,
        [urlBackgroundList, urlBackgroundSelectedId],
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);

    // Defer iframe rendering until container has non-zero dimensions.
    // This prevents embedded page scripts from initialising with a 0x0 canvas/viewport,
    // which causes IndexSizeError and leaves the iframe permanently blank.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            setReady(true);
            return;
        }
        // Container not laid out yet — use rAF to wait for next paint.
        let cancelled = false;
        const check = () => {
            if (cancelled) return;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                setReady(true);
            } else {
                requestAnimationFrame(check);
            }
        };
        requestAnimationFrame(check);
        return () => { cancelled = true; };
    }, [selectedItem]);

    if (!selectedItem?.url) return null;

    return (
        <div ref={containerRef} className="absolute inset-0 z-0 overflow-hidden">
            {/* key forces React to destroy and recreate the iframe when URL changes,
                preventing chrome-error://chromewebdata cross-origin navigation errors */}
            {ready && (
                <iframe
                    key={selectedItem.url}
                    src={selectedItem.url}
                    title={selectedItem.note || selectedItem.url}
                    className="w-full h-full border-0"
                    style={{
                        pointerEvents: 'none',
                    }}
                    allowFullScreen
                />
            )}
            {/* Semi-transparent overlay to ensure lyrics readability */}
            <div
                className="absolute inset-0"
                style={{
                    background: 'linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.35))',
                    pointerEvents: 'none',
                }}
            />
        </div>
    );
};

export default UrlBackgroundLayer;
