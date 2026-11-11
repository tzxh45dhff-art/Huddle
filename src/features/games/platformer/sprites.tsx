import { CHARACTERS } from "../../../../server/src/games/platformer.physics";
import { SPRITES, palette } from "./spriteArt";
export function Portrait({ character }: { character: number }) {
  return (
    <svg
      viewBox="0 0 16 20"
      shapeRendering="crispEdges"
      role="img"
      aria-label={CHARACTERS[character]}
    >
      {SPRITES[character]!.flatMap((row, y) =>
        Array.from(row, (char, x) =>
          char === " " ? null : (
            <rect
              key={`${x}:${y}`}
              x={x}
              y={y}
              width="1"
              height="1"
              fill={palette[char] ?? "#fff"}
            />
          ),
        ),
      )}
    </svg>
  );
}
