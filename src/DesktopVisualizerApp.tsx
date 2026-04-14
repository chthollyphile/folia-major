import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { Check, Monitor, MousePointerClick, Square } from 'lucide-react';
import Visualizer from './components/visualizer/Visualizer';
import VisualizerCadenza from './components/visualizer/VisualizerCadenza';
import VisualizerPartita from './components/visualizer/VisualizerPartita';
import type { DesktopVisualizerSnapshot } from './types';

const EMPTY_BANDS = {
    bass: 0,
    lowMid: 0,
    mid: 0,
    vocal: 0,
    treble: 0,
};

type DesktopWindowOptions = {
    clickThrough: boolean;
    showBorder: boolean;
};

const DEFAULT_OPTIONS: DesktopWindowOptions = {
    clickThrough: false,
    showBorder: false,
};

export default function DesktopVisualizerApp() {
    const [snapshot, setSnapshot] = useState<DesktopVisualizerSnapshot | null>(null);
    const [options, setOptions] = useState<DesktopWindowOptions>(DEFAULT_OPTIONS);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const audioBands = useMemo(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
    }), [bass, lowMid, mid, treble, vocal]);

    useEffect(() => {
        const previousBackground = document.body.style.backgroundColor;
        const previousOverflow = document.body.style.overflow;
        document.body.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.backgroundColor = previousBackground;
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        window.addEventListener('mousedown', handlePointerDown);
        return () => {
            window.removeEventListener('mousedown', handlePointerDown);
        };
    }, []);

    useEffect(() => {
        if (!window.electron) {
            return;
        }

        let disposed = false;

        window.electron.getDesktopVisualizerState().then((nextSnapshot) => {
            if (!disposed && nextSnapshot) {
                setSnapshot(nextSnapshot);
            }
        }).catch((error) => {
            console.error('[DesktopVisualizer] Failed to get initial state:', error);
        });

        window.electron.getDesktopVisualizerOptions().then((nextOptions) => {
            if (!disposed && nextOptions) {
                setOptions(nextOptions);
            }
        }).catch((error) => {
            console.error('[DesktopVisualizer] Failed to get window options:', error);
        });

        const unsubscribeState = window.electron.onDesktopVisualizerState((nextSnapshot) => {
            setSnapshot(nextSnapshot);
        });
        const unsubscribeOptions = window.electron.onDesktopVisualizerOptions((nextOptions) => {
            setOptions(nextOptions);
        });

        return () => {
            disposed = true;
            unsubscribeState?.();
            unsubscribeOptions?.();
        };
    }, []);

    useEffect(() => {
        if (!snapshot) {
            return;
        }

        currentTime.set(snapshot.currentTime);
        audioPower.set(snapshot.audioPower);
        audioBands.bass.set(snapshot.audioBands?.bass ?? EMPTY_BANDS.bass);
        audioBands.lowMid.set(snapshot.audioBands?.lowMid ?? EMPTY_BANDS.lowMid);
        audioBands.mid.set(snapshot.audioBands?.mid ?? EMPTY_BANDS.mid);
        audioBands.vocal.set(snapshot.audioBands?.vocal ?? EMPTY_BANDS.vocal);
        audioBands.treble.set(snapshot.audioBands?.treble ?? EMPTY_BANDS.treble);
    }, [audioBands, audioPower, currentTime, snapshot]);

    const transparentTheme = useMemo(() => {
        if (!snapshot) {
            return null;
        }

        return {
            ...snapshot.theme,
            backgroundColor: 'transparent',
        };
    }, [snapshot]);

    const handleUpdateOptions = async (patch: Partial<DesktopWindowOptions>) => {
        if (!window.electron) {
            return;
        }

        try {
            const nextOptions = await window.electron.setDesktopVisualizerOptions(patch);
            setOptions(nextOptions);
        } catch (error) {
            console.error('[DesktopVisualizer] Failed to update window options:', error);
        }
    };

    if (!snapshot || !transparentTheme) {
        return <div className="fixed inset-0 bg-transparent" />;
    }

    const sharedProps = {
        currentTime,
        currentLineIndex: snapshot.currentLineIndex,
        lines: snapshot.lines,
        theme: transparentTheme,
        audioPower,
        audioBands,
        coverUrl: snapshot.coverUrl || undefined,
        showText: snapshot.showText,
        useCoverColorBg: false,
        seed: snapshot.seed,
        staticMode: snapshot.staticMode,
        backgroundOpacity: 0,
        lyricsFontScale: snapshot.lyricsFontScale,
        onBack: () => undefined,
        desktopMode: true,
    };

    return (
        <div className="fixed inset-0 overflow-hidden bg-transparent">
            {options.showBorder && (
                <div className="pointer-events-none absolute inset-0 z-[95] rounded-[2px] border border-white/35" />
            )}

            <div
                ref={menuRef}
                className="absolute left-3 top-3 z-[100] flex flex-col items-start"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <button
                    type="button"
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/75 backdrop-blur-md transition-colors hover:bg-black/30"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen((value) => !value);
                    }}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMenuOpen(true);
                    }}
                    title="Desktop Visualizer Menu"
                >
                    <Monitor size={14} />
                    <span>Desktop Visualizer</span>
                </button>

                {menuOpen && (
                    <div className="mt-2 min-w-56 overflow-hidden rounded-2xl border border-white/10 bg-black/70 p-2 text-sm text-white/85 shadow-2xl backdrop-blur-xl">
                        <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                            onClick={() => {
                                void handleUpdateOptions({ clickThrough: !options.clickThrough });
                                setMenuOpen(false);
                            }}
                        >
                            <span className="flex items-center gap-2">
                                <MousePointerClick size={16} />
                                <span>点击穿透</span>
                            </span>
                            {options.clickThrough && <Check size={16} />}
                        </button>

                        <button
                            type="button"
                            className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/10"
                            onClick={() => {
                                void handleUpdateOptions({ showBorder: !options.showBorder });
                                setMenuOpen(false);
                            }}
                        >
                            <span className="flex items-center gap-2">
                                <Square size={16} />
                                <span>显示边框</span>
                            </span>
                            {options.showBorder && <Check size={16} />}
                        </button>

                        <div className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/55">
                            点击穿透快捷键：`Alt+Shift+V`
                        </div>
                    </div>
                )}
            </div>

            {snapshot.visualizerMode === 'cadenza' ? (
                <VisualizerCadenza
                    {...sharedProps}
                    cadenzaTuning={snapshot.cadenzaTuning}
                />
            ) : snapshot.visualizerMode === 'partita' ? (
                <VisualizerPartita
                    {...sharedProps}
                    partitaTuning={snapshot.partitaTuning}
                />
            ) : (
                <Visualizer
                    {...sharedProps}
                />
            )}
        </div>
    );
}
