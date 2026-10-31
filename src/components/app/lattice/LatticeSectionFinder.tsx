import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { summaryOfSection } from "./exploreWall";
import type { WallSection } from "./wallLayout";
import "./LatticeSections.css";
import { useGlass } from "@/shinoinject/useGlass";

// src/components/app/lattice/LatticeSectionFinder.tsx
// The explore wall's way to a section: a pill beside the wall's own buttons that names the
// section the window stands in ('3/9 · heading'), and, pressed, the list of all sections in the
// page's order. Choosing one takes the wall there (useWallSections.ts). The queue wall has none.
// A press with the mouse leaves the focus where it is, as the wall's "refresh" does: the wall's
// keys are handled on .lattice-field and reach it only while the focus is inside it.
// The list grows out of the pill (its own origin is measured at the pill's centre) and shrinks
// back into it when it closes; the closing list stays mounted for the length of the animation.

// How long the list takes to grow out of the pill and to shrink back into it (ms).
// It must match the length of the animation in LatticeSections.css (.lattice-sections-list).
const LIST_ANIM_MS = 220;

/** The list's life: closed (not in the page), mounting (measured, not yet animated),
 *  open (grown out of the pill), closing (shrinking back into it). */
type ListPhase = "closed" | "mounting" | "open" | "closing";

type LatticeSectionFinderProps = {
  sections: WallSection[];
  /** The section the window stands in, as its place in `sections`. */
  current: number;
  onChoose: (section: number) => void;
  /** The wall's day/night mode: the list's own ground and edges follow it. */
  isDaylight: boolean;
};

export default function LatticeSectionFinder({
  sections,
  current,
  onChoose,
  isDaylight,
}: LatticeSectionFinderProps) {
  const { t } = useTranslation();
  const [listPhase, setListPhase] = useState<ListPhase>("closed");
  const pillRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  // The list is there while it grows, is open, and shrinks back; only "closed" takes it out.
  const isOpen = listPhase !== "closed";

  // Open: mount the list, measure where the pill is in it, then let the animation run.
  const openList = () => {
    if (listPhase !== "closed") return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setListPhase("mounting");
  };

  // The wall's own reduced motion (the store writes it on <html>): the list then appears at once
// and is taken out of the page at once, without waiting for the animation.
const wallReducedMotion = () =>
  (document.documentElement.getAttribute("data-reduce-motion") || "")
    .split(/\s+/)
    .includes("lattice");

// Close: the list shrinks back into the pill and is taken out of the page afterwards.
const closeList = () => {
    if (listPhase === "closed" || listPhase === "closing") return;
    if (wallReducedMotion()) {
      setListPhase("closed");
      return;
    }
    setListPhase("closing");
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setListPhase("closed");
    }, LIST_ANIM_MS);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // The list grows out of the pill: its origin is the pill's centre, in the list's own
  // coordinates. Measured before the animation starts, so the list is still at its own size.
  useLayoutEffect(() => {
    if (listPhase !== "mounting") return;
    const list = listRef.current;
    const pill = pillRef.current;
    if (!list || !pill) {
      setListPhase("open");
      return;
    }
    const listRect = list.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    list.style.setProperty(
      "--lattice-sections-origin-x",
      `${pillRect.left + pillRect.width / 2 - listRect.left}px`,
    );
    list.style.setProperty(
      "--lattice-sections-origin-y",
      `${pillRect.top + pillRect.height / 2 - listRect.top}px`,
    );
    setListPhase("open");
  }, [listPhase]);

  // A press anywhere else closes the list: on the wall it starts a drag, and the list would be in its way.
  useEffect(() => {
    if (!isOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (
        target &&
        (pillRef.current?.contains(target) || listRef.current?.contains(target))
      )
        return;
      closeList();
    };
    window.addEventListener("pointerdown", closeFromOutside, true);
    return () =>
      window.removeEventListener("pointerdown", closeFromOutside, true);
  }, [isOpen]);

  const section = sections[current];
  if (!section) return null;

  // Escape, with the focus on the pill or in the list, closes the list and nothing else.
  const closeOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !isOpen) return;
    event.preventDefault();
    event.stopPropagation();
    closeList();
    pillRef.current?.focus({ preventScroll: true });
  };
  const position = `${current + 1}/${sections.length}`;
  const name = section.heading ? `${position} · ${section.heading}` : position;
  useGlass();
  return (
    <>
      <button
        ref={pillRef}
        type="button"
        className="lattice-back lattice-sections-pill mx-[10px]"
        data-glass
        data-glass-jelly
        data-glass-light
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`${t("home.latticeSections")}: ${name}`}
        title={t("home.latticeSections")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (isOpen ? closeList() : openList())}
        onKeyDown={closeOnEscape}
      >
        <span className="lattice-sections-name">{name}</span>
        <ChevronDown size={16} />
      </button>
      {isOpen && (
        <div
          data-glass data-glass-jelly data-glass-light
          ref={listRef}
          className={`lattice-sections-list${
            listPhase === "closing"
              ? " is-shrinking"
              : listPhase === "open"
                ? " is-growing"
                : ""
          }`}
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
          role="menu"
          aria-label={t("home.latticeSections")}
          onKeyDown={closeOnEscape}
        >
          {sections.map((entry, index) => (
            <button
              key={`${index}:${entry.key}`}
              type="button"
              role="menuitem"
              className={index === current ? "is-current mx-[5px]" : "mx-[5px]"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                closeList();
                onChoose(index);
              }}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {/* A section without a heading is told by what it holds. */}
              <span>{entry.heading || summaryOfSection(entry, t)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
