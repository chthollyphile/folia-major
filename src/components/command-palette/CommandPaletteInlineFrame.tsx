import React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import type { Theme } from "../../types";
import type { SyntaxSuggestion } from "./syntax/suggest";
import type { GridFilterAction } from "./gridFilterQuery";
import CommandPaletteSyntaxHints from "./CommandPaletteSyntaxHints";
import { gridSearchPanelMotion } from "../shared/gridSearchPanelMotion";
import { useGlass } from "@/shinoinject/useGlass";

// src/components/command-palette/CommandPaletteInlineFrame.tsx
// The palette wearing a surface's own filter box instead of its overlay.
//
// Split out of CommandPalette so the pill can grow the parts the overlay gets for free — the `--`
// completion strip and the "this many songs" line — without the overlay branch and this one drifting
// into two different inputs. The input itself is still rendered by the caller, once, for both frames.

type CommandPaletteInlineFrameProps = {
  anchor: HTMLElement;
  isOpen: boolean;
  query: string;
  renderInput: (className: string) => React.ReactNode;
  onQueryCommit: (query: string) => void;
  onClose: () => void;
  focusInput: () => void;
  suggestions: SyntaxSuggestion[];
  syntaxIndex: number;
  onAcceptSuggestion: (suggestion: SyntaxSuggestion) => void;
  onHoverSuggestion: (index: number) => void;
  /** What the typed flag would do and to how many songs; null when no flag is typed. */
  pendingAction: { action: GridFilterAction; count: number } | null;
  isDaylight: boolean;
  theme: Theme;
  t: (
    key: string,
    options?: { defaultValue?: string; count?: number },
  ) => string;
};

const CommandPaletteInlineFrame: React.FC<CommandPaletteInlineFrameProps> = ({
  anchor,
  isOpen,
  query,
  renderInput,
  onQueryCommit,
  onClose,
  focusInput,
  suggestions,
  syntaxIndex,
  onAcceptSuggestion,
  onHoverSuggestion,
  pendingAction,
  isDaylight,
  theme,
  t,
}) => {
  useGlass();
  return createPortal(
    // Portalled into the host's own element, so the box keeps the position that host gave it
    // rather than a viewport offset guessed here. Same entrance the grids animated with, too.
    <AnimatePresence>
      {isOpen && (
        <motion.div
          {...gridSearchPanelMotion}
          data-folia-keyboard-window="true"
          data-testid="command-palette-filter"
          className="absolute top-24 left-1/2 z-[85] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 pointer-events-auto"
        >
          <div
            data-glass
            data-glass-jelly data-glass-light
            className="relative rounded-full border shadow-2xl theme-glass-panel"
            style={{
              backgroundColor: isDaylight
                ? "rgba(255,255,255,0.4)"
                : "rgba(0,0,0,0.4)",
              borderTop: isDaylight
                ? "1px solid rgba(0,0,0,0.08)"
                : "1px solid rgba(255,255,255,0.12)",
              borderBottom: isDaylight
                ? "1px solid rgba(0,0,0,0.08)"
                : "1px solid rgba(255,255,255,0.12)",
              outline: "1px solid rgba(40,40,40,0.2)",
              boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4),inset 0px -4px 8px rgba(40,40,40,0.4)",
            }}
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4" />
            {renderInput(
              "w-full rounded-full bg-transparent py-3 pl-11 pr-11 text-sm font-medium outline-none placeholder:text-current placeholder:opacity-40",
            )}
            <button
              type="button"
              onClick={() => {
                // Clear first, close second — the grids' own button did the
                // same, and it is the only way to undo a filter with the mouse.
                if (query) {
                  onQueryCommit("");
                  window.requestAnimationFrame(focusInput);
                  return;
                }
                onClose();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 opacity-45 transition-opacity hover:opacity-90 cursor-pointer"
              aria-label={query ? t("ui.clear") : t("ui.close")}
            >
              <X size={15} />
            </button>
          </div>

          {(suggestions.length > 0 || pendingAction !== null) && (
            <div className="mt-2 rounded-2xl border p-2 shadow-2xl backdrop-blur-2xl theme-glass-panel">
              <CommandPaletteSyntaxHints
                suggestions={suggestions}
                activeIndex={syntaxIndex}
                onAccept={onAcceptSuggestion}
                onHover={onHoverSuggestion}
                isDaylight={isDaylight}
                theme={theme}
                t={t}
              />
              {pendingAction !== null && (
                <div
                  className="px-2 pb-1 text-[11px] font-medium opacity-70"
                  data-testid="command-palette-filter-action"
                >
                  {/* The very words on the two buttons this stands in for, so Enter
                                    promises the listener exactly what the mouse would have. */}
                  {pendingAction.action === "play"
                    ? t("playlist.playFilteredTracks", {
                        defaultValue: "Play {{count}} songs",
                        count: pendingAction.count,
                      })
                    : t("playlist.addFilteredTracksToQueue", {
                        defaultValue: "Add {{count}} songs to queue",
                        count: pendingAction.count,
                      })}
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    anchor,
  );
};
export default CommandPaletteInlineFrame;
