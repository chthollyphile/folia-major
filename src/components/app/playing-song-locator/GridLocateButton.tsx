import React, { useState } from "react";
import { Crosshair } from "lucide-react";

// src/components/app/playing-song-locator/GridLocateButton.tsx
// "Is the song that is playing on this page": the small round button that stands above a grid's
// action button (GridListSearchButton's `above`). It is lit while the song is one of the cards
// of the page it stands on, so that a glance tells what a press will find.
// A press answers at once with a ring that leaves the button and a mark that turns into place.
// A page that was opened to show the song (the player's "playing from") may still wait for the
// tracks that hold it: rings keep leaving the button for as long as it does.
// The walls (lattice, and the bravais library) carry the same button above their tools button, for their tiles.

interface GridLocateButtonProps {
  isDaylight: boolean;
  accentColor: string;
  /** The playing song is one of this page's cards. */
  isHere: boolean;
  /** The page was asked for the song and has not answered yet. */
  isSeeking: boolean;
  title: string;
  onLocate: () => void;
}

export const GridLocateButton: React.FC<GridLocateButtonProps> = ({
  isDaylight,
  accentColor,
  isHere,
  isSeeking,
  title,
  onLocate,
}) => {
  const [presses, setPresses] = useState(0);
  return (
    <button
      data-glass
      data-glass-jelly
      data-glass-light
      type="button"
      data-grid-locate={isHere ? "here" : "elsewhere"}
      data-grid-locate-seeking={isSeeking ? "yes" : "no"}
      aria-busy={isSeeking}
      title={title}
      aria-label={title}
      onClick={() => {
        setPresses((count) => count + 1);
        onLocate();
      }}
      style={{
        color: "var(--text-primary)",
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
        transformOrigin: "bottom right",
      }}
      // It moves with the action button below it: half out of the way on a narrow window, whole on a wide one.
      className={`relative flex h-12 w-12 translate-x-1/2 items-center justify-center rounded-full opacity-60 shadow-lg backdrop-blur-md transition-all duration-300 active:scale-90 group-hover:translate-x-0 group-hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105`}
    >
      {isSeeking ? (
        <span
          className="locate-seeking pointer-events-none absolute inset-0 rounded-full border"
          style={{ borderColor: accentColor }}
        />
      ) : (
        presses > 0 && (
          <span
            key={`ring-${presses}`}
            className="locate-ring pointer-events-none absolute inset-0 rounded-full border"
            style={{ borderColor: accentColor }}
          />
        )
      )}
      <Crosshair
        key={presses}
        size={18}
        className={presses > 0 ? "locate-mark" : undefined}
        style={{ color: isHere ? accentColor : undefined }}
      />
    </button>
  );
};
