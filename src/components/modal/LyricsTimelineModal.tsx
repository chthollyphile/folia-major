import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  motion,
  AnimatePresence,
  MotionValue,
  useMotionValueEvent,
} from "framer-motion";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LyricData, Theme } from "../../types";
import {useGlass} from "@/shinoinject/useGlass";

interface LyricsTimelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  lyrics: LyricData | null;
  duration: number;
  currentTime: MotionValue<number>;
  onSeek: (time: number) => void;
  disabled?: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  theme?: Theme;
  isDaylight: boolean;
}

const LyricsTimelineModal: React.FC<LyricsTimelineModalProps> = ({
  isOpen,
  onClose,
  lyrics,
  duration,
  currentTime,
  onSeek,
  disabled = false,
  primaryColor = "var(--text-primary)",
  secondaryColor = "var(--text-secondary)",
  accentColor = "var(--text-accent)",
  theme,
  isDaylight,
}) => {
  const { t } = useTranslation();
  // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
  const glassBg = isDaylight ? "bg-white/70" : "bg-black/40";
  const borderColor = isDaylight ? "border-black/5" : "border-white/10";

  // Timeline Item Styles
  const itemBg = isDaylight ? "bg-white/60" : "bg-black/60";
  const itemBorder = isDaylight ? "border-black/5" : "border-white/10";
  const itemHoverBg = isDaylight ? "hover:bg-white/80" : "hover:bg-black/70";
  const itemTextPrimary = isDaylight ? "text-zinc-800" : "text-white";
  const itemTextSecondary = isDaylight ? "text-zinc-500" : "text-white/60";
  const headerText = isDaylight ? "text-zinc-800/90" : "text-white/90";
  const closeIconColor = isDaylight ? "text-zinc-800/70" : "text-white/70";
  const closeBtnHover = isDaylight ? "hover:bg-black/5" : "hover:bg-white/10";
  const disabledCursorClass = disabled
    ? "cursor-not-allowed"
    : "cursor-pointer";
  const disabledItemClass = disabled ? "opacity-65" : "";
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoScrolling = useRef(false);
  const windowRef = useRef<HTMLDivElement>(null);

  // Track active line
  useMotionValueEvent(currentTime, "change", (latest) => {
    if (!lyrics || !lyrics.lines) return;
    const index = lyrics.lines.findIndex(
      (line) => latest >= line.startTime && latest <= line.endTime,
    );
    if (index !== -1 && index !== activeLineIndex) {
      setActiveLineIndex(index);
    }
  });

  // Reset activeLineIndex when lyrics change (e.g., when switching songs)
  useEffect(() => {
    setActiveLineIndex(-1);
  }, [lyrics]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat) return;
      // The command palette can open above the timeline; its Escape is its own.
      const target = event.target;
      if (target instanceof Element) {
        const owner = target.closest('[data-folia-keyboard-window="true"]');
        if (owner && owner !== windowRef.current) return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Handle user scroll
  const handleScroll = () => {
    if (isAutoScrolling.current) {
      return;
    }
    setIsUserScrolling(true);

    // Clear existing timeout
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }

    // Set timeout to return to auto-scroll after 3 seconds
    userScrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
    }, 3000);
  };

  // Auto-scroll to active lyric (only when not user scrolling)
  useEffect(() => {
    if (isUserScrolling) return;

    if (
      activeItemRef.current &&
      scrollContainerRef.current &&
      activeLineIndex !== -1
    ) {
      // Clear any existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Scroll immediately
      const container = scrollContainerRef.current;
      const activeItem = activeItemRef.current;

      if (container && activeItem) {
        const containerHeight = container.clientHeight;
        const itemOffsetTop = activeItem.offsetTop;
        const itemHeight = activeItem.clientHeight;

        // Scroll to center the active item
        const scrollTo = itemOffsetTop - containerHeight / 2 + itemHeight / 2;

        container.scrollTo({
          top: scrollTo,
          behavior: "smooth",
        });

        // Allow some time for the scroll event to fire and be ignored
        isAutoScrolling.current = true;
        // Add a small timeout to clear the flag in case the scroll event doesn't fire (e.g. already at position)
        setTimeout(() => {
          isAutoScrolling.current = false;
        }, 1000);
      }
    }

    // Cleanup
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [activeLineIndex, isUserScrolling]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Initial scroll when modal opens
  useEffect(() => {
    if (isOpen && activeItemRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const activeItem = activeItemRef.current;

      setTimeout(() => {
        const containerHeight = container.clientHeight;
        const itemOffsetTop = activeItem.offsetTop;
        const itemHeight = activeItem.clientHeight;

        const scrollTo = itemOffsetTop - containerHeight / 2 + itemHeight / 2;

        container.scrollTo({
          top: scrollTo,
          behavior: "auto",
        });
      }, 100);
    }
  }, [isOpen]);

  // Generate vertical dot positions
  const dots = useMemo(() => {
    if (!lyrics || !lyrics.lines || duration <= 0) return [];

    return lyrics.lines.map((line, index) => {
      // Alternating left and right
      const isLeft = index % 2 === 0;

      return {
        ...line,
        id: index,
        isLeft,
      };
    });
  }, [lyrics, duration]);

  const handleSeek = (time: number) => {
    if (disabled) {
      return;
    }

    onSeek(time);
  };
  useGlass();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={windowRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          data-folia-keyboard-window="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
          onClick={onClose}
        >
          <motion.div
            data-glass
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
              boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4)",
            }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className={`w-[90vw] max-w-4xl h-[80vh] ${glassBg} border ${borderColor} rounded-2xl p-8 relative flex flex-col`}
            onClick={(e) => e.stopPropagation()}
          >
            <svg
              width="0"
              height="0"
              style={{ position: "absolute" }}
              aria-hidden="true"
            >
              <defs id="filter-defs"></defs>
            </svg>
            {/* Header */}
            <div className="flex justify-between items-center mb-8 flex-shrink-0">
              <h2 className={`text-2xl font-bold ${headerText}`}>
                {t("timeline.title")}
              </h2>
              <button
                onClick={onClose}
                className={`p-2 ${closeBtnHover} rounded-full transition-colors`}
              >
                <X size={24} className={closeIconColor} />
              </button>
            </div>

            {/* Scrollable Timeline Container */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              onTouchMove={handleScroll}
              className="flex-1 overflow-y-auto overflow-x-hidden px-8 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent"
              style={{
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(255,255,255,0.2) transparent",
              }}
            >
              {dots.length > 0 ? (
                <div className="relative py-8">
                  {/* Vertical Center Line - left aligned on mobile */}
                  <div
                    className="absolute left-1/2 max-md:left-[6px] top-0 bottom-0 w-[2px] -translate-x-1/2 max-md:translate-x-0"
                    style={{ backgroundColor: secondaryColor, opacity: 0.3 }}
                  />

                  {/* Dots and Lyrics */}
                  {dots.map((dot, index) => {
                    const isActive = index === activeLineIndex;
                    const isLeft = dot.isLeft;

                    return (
                      <div
                        key={dot.id}
                        ref={isActive ? activeItemRef : null}
                        className="relative w-full flex items-center mb-20"
                        style={{ zIndex: isActive ? 20 : 1 }}
                      >
                        {/* Left side content */}
                        <div className="w-1/2 flex justify-end pr-4 max-md:hidden">
                          {isLeft && (
                            <motion.div
                              animate={{
                                scale: isActive ? 1 : 0.85,
                                opacity: isActive ? 1 : 0.7,
                              }}
                              transition={{ duration: 0.3 }}
                              className="max-w-[90%]"
                            >
                              <div
                                className={`inline-block ${itemBg} backdrop-blur-xl border ${itemBorder} rounded-lg p-6 ${disabledCursorClass} ${disabledItemClass} ${disabled ? "" : itemHoverBg} transition-all`}
                                onClick={() => {
                                  handleSeek(dot.startTime);
                                }}
                              >
                                <div className="text-right">
                                  <p
                                    className={`${itemTextPrimary} font-medium transition-all ${
                                      isActive ? "text-base" : "text-sm"
                                    }`}
                                  >
                                    {dot.fullText}
                                  </p>
                                  {dot.translation && (
                                    <p
                                      className={`${itemTextSecondary} mt-1 transition-all ${
                                        isActive ? "text-sm" : "text-xs"
                                      }`}
                                    >
                                      {dot.translation}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </div>

                        {/* Center Dot - left aligned on mobile */}
                        <div className="flex-shrink-0 z-10 max-md:absolute max-md:left-0">
                          <motion.div
                            animate={{
                              scale: isActive ? 1.5 : 1,
                              backgroundColor: isActive
                                ? accentColor
                                : secondaryColor,
                            }}
                            transition={{ duration: 0.3 }}
                            className={`w-3 h-3 rounded-full ${disabledCursorClass}`}
                            style={{
                              boxShadow: isActive
                                ? `0 0 20px ${accentColor}`
                                : "none",
                            }}
                            onClick={() => {
                              handleSeek(dot.startTime);
                            }}
                            whileHover={
                              disabled
                                ? undefined
                                : { scale: isActive ? 1.7 : 1.3 }
                            }
                          />
                        </div>

                        {/* Right side content */}
                        <div className="w-1/2 flex justify-start pl-4 max-md:hidden">
                          {!isLeft && (
                            <motion.div
                              animate={{
                                scale: isActive ? 1 : 0.85,
                                opacity: isActive ? 1 : 0.7,
                              }}
                              transition={{ duration: 0.3 }}
                              className="max-w-[90%]"
                            >
                              <div
                                className={`inline-block ${itemBg} backdrop-blur-xl border ${itemBorder} rounded-lg p-6 ${disabledCursorClass} ${disabledItemClass} ${disabled ? "" : itemHoverBg} transition-all`}
                                onClick={() => {
                                  handleSeek(dot.startTime);
                                }}
                              >
                                <div className="text-left">
                                  <p
                                    className={`${itemTextPrimary} font-medium transition-all ${
                                      isActive ? "text-base" : "text-sm"
                                    }`}
                                  >
                                    {dot.fullText}
                                  </p>
                                  {dot.translation && (
                                    <p
                                      className={`${itemTextSecondary} mt-1 transition-all ${
                                        isActive ? "text-sm" : "text-xs"
                                      }`}
                                    >
                                      {dot.translation}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </div>

                        {/* Mobile layout - left aligned with dot */}
                        <motion.div
                          animate={{
                            scale: isActive ? 1 : 0.85,
                            opacity: isActive ? 1 : 0.7,
                          }}
                          transition={{ duration: 0.3 }}
                          className="hidden max-md:block absolute left-6 right-0"
                        >
                          <div
                            className={`${itemBg} backdrop-blur-xl border ${itemBorder} rounded-lg p-4 ${disabledCursorClass} ${disabledItemClass} ${disabled ? "" : itemHoverBg} transition-all`}
                            onClick={() => {
                              handleSeek(dot.startTime);
                            }}
                          >
                            <div className="text-left">
                              <p
                                className={`${itemTextPrimary} font-medium transition-all ${
                                  isActive ? "text-base" : "text-sm"
                                }`}
                              >
                                {dot.fullText}
                              </p>
                              {dot.translation && (
                                <p
                                  className={`${itemTextSecondary} mt-1 transition-all ${
                                    isActive ? "text-sm" : "text-xs"
                                  }`}
                                >
                                  {dot.translation}
                                </p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  className={`flex items-center justify-center h-full ${itemTextSecondary}`}
                >
                  {t("timeline.noLyrics")}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LyricsTimelineModal;
