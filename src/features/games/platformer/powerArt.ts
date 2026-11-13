import {
  POWERS,
  type PowerKind,
} from "../../../../server/src/games/platformer.physics";
/** Shared pixel icons for the HUD and the reward rising out of a block. */
export const POWER_PIXELS: Record<PowerKind, string[]> = {
  star: [
    "...XX...",
    "...XX...",
    "XXXXXXXX",
    ".XXXXXX.",
    "..XXXX..",
    ".XXXXXX.",
    ".XX..XX.",
    "XX....XX",
  ],
  dash: [
    ".....XX.",
    "....XX..",
    "...XX...",
    "..XXXXX.",
    "....XX..",
    "...XX...",
    "..XX....",
    ".XX.....",
  ],
  spring: [
    "...XX...",
    "..XXXX..",
    ".XXXXXX.",
    "...XX...",
    "...XX...",
    ".XXXXXX.",
    "..XXXX..",
    ".XXXXXX.",
  ],
  magnet: [
    "XX....XX",
    "XX....XX",
    "XX....XX",
    "XX....XX",
    "XX....XX",
    ".XX..XX.",
    "..XXXX..",
    "...XX...",
  ],
};
export function drawPowerIcon(
  c: CanvasRenderingContext2D,
  kind: PowerKind,
  x: number,
  y: number,
  size = 3,
) {
  c.fillStyle = POWERS[kind].color;
  POWER_PIXELS[kind].forEach((row, iy) =>
    [...row].forEach((on, ix) => {
      if (on === "X")
        c.fillRect(
          Math.round(x + ix * size),
          Math.round(y + iy * size),
          size,
          size,
        );
    }),
  );
}
