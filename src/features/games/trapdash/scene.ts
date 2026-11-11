import {
  COLORS,
  FLOOR,
  GAPS,
  SLOTS,
  TRACK,
  type Runner,
} from "../../../../server/src/games/trapdash.physics";
import type { TrapDashView } from "../../../../server/src/games/trapdash.physics";
export type SceneMemory = {
  camera: number;
  positions: Map<string, { x: number; y: number }>;
};
const round = (
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) => {
  c.fillStyle = fill;
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
};
export function paint(
  c: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: TrapDashView,
  self: string | undefined,
  memory: SceneMemory,
  dt: number,
  now: number,
  reduced: boolean,
) {
  const overview = state.phase === "place" || state.phase === "countdown";
  const worldWidth = overview
    ? width < 700
      ? 950
      : TRACK + 80
    : width < 700
      ? 640
      : Math.max(820, Math.min(1350, (width / height) * 600));
  const scale = width / worldWidth;
  const worldHeight = height / scale;
  const offsetY = Math.max(0, (worldHeight - 590) / 2);
  const target = state.players.find((p) => p.id === self) ?? state.players[0]!;
  const camera = overview
    ? width < 700 && state.phase === "place" && state.mine
      ? Math.max(
          -40,
          Math.min(
            TRACK - worldWidth + 40,
            SLOTS[state.mine.slot]! - worldWidth / 2,
          ),
        )
      : -40
    : Math.max(
        -30,
        Math.min(TRACK - worldWidth + 30, target.x - worldWidth * 0.32),
      );
  memory.camera += (camera - memory.camera) * (1 - Math.exp(-dt * 9));
  if (overview && width >= 700) memory.camera = camera;
  const sky = c.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#142f43");
  sky.addColorStop(0.6, "#386c75");
  sky.addColorStop(1, "#ecc7a0");
  c.fillStyle = sky;
  c.fillRect(0, 0, width, height);
  c.save();
  c.scale(scale, scale);
  c.translate(0, offsetY);
  c.fillStyle = "#fce1a5";
  c.beginPath();
  c.arc(worldWidth * 0.78, 100, 57, 0, Math.PI * 2);
  c.fill();
  // Three layers of hills drift at different speeds behind the course.
  for (let layer = 0; layer < 3; layer++) {
    c.fillStyle = ["#366776", "#468184", "#76a39a"][layer]!;
    c.beginPath();
    c.moveTo(0, worldHeight);
    for (let x = -100; x <= worldWidth + 100; x += 20) {
      const y =
        280 +
        layer * 53 +
        Math.sin(
          (x + memory.camera * (0.12 + layer * 0.12)) / (210 - layer * 35),
        ) *
          (55 - layer * 10);
      c.lineTo(x, y);
    }
    c.lineTo(worldWidth + 100, worldHeight);
    c.fill();
  }
  c.translate(-memory.camera, 0);
  for (let i = 0; i < 15; i++) {
    const x = i * 211 + 20,
      y = 100 + Math.sin(i * 5) * 50;
    round(c, x, y, 100, 18, 12, "#d6e7d229");
    round(c, x + 27, y - 12, 42, 24, 14, "#d6e7d229");
  }
  const platforms = [
    [0, 590],
    [690, 1210],
    [1320, 1900],
    [2010, 2600],
  ];
  for (const [a, b] of platforms) {
    round(c, a!, FLOOR + 5, b! - a!, 105, 22, "#183a44");
    round(c, a!, FLOOR, b! - a!, 20, 9, "#b6ddab");
    round(c, a! + 5, FLOOR + 20, b! - a! - 10, 65, 12, "#477d73");
    for (let x = a! + 18; x < b! - 15; x += 38)
      round(c, x, FLOOR + 35, 13, 5, 3, "#79a493");
  }
  for (const [a, b] of GAPS) {
    c.fillStyle = "#ffe1ab";
    c.font = "bold 13px Inter, sans-serif";
    c.textAlign = "center";
    c.fillText("JUMP", (a! + b!) / 2, FLOOR + 80);
  }
  // Start and finish flags are readable before the first race.
  for (const x of [50, 2510]) {
    round(c, x, FLOOR - 150, 6, 150, 3, "#f8e5c5");
    round(c, x + 6, FLOOR - 150, 80, 37, 5, x === 50 ? "#78dfcf" : "#ffc66a");
    c.fillStyle = "#193c44";
    c.font = "900 15px Inter, sans-serif";
    c.textAlign = "center";
    c.fillText(x === 50 ? "START" : "FINISH", x + 45, FLOOR - 126);
  }
  if (overview)
    SLOTS.forEach((x, i) => {
      const chosen = state.mine?.slot === i;
      round(
        c,
        x - 27,
        FLOOR - 50,
        54,
        45,
        10,
        chosen ? "#ffe0a0" : "#ffffff20",
      );
      c.strokeStyle = "#f5efd4";
      c.lineWidth = 2;
      c.setLineDash([4, 5]);
      c.strokeRect(x - 27, FLOOR - 50, 54, 45);
      c.setLineDash([]);
      c.fillStyle = chosen ? "#193c44" : "#fff4d9";
      c.font = "bold 20px Inter";
      c.textAlign = "center";
      c.fillText(String(i + 1), x, FLOOR - 20);
    });
  state.traps.forEach((t) => {
    const x = SLOTS[t.slot]!,
      color =
        COLORS[
          Math.max(
            0,
            state.players.findIndex((p) => p.id === t.owner),
          ) % COLORS.length
        ]!;
    round(c, x - 30, FLOOR + 17, 60, 5, 2, color);
    if (t.kind === "spring") {
      c.strokeStyle = "#ffd58c";
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(x - 20, FLOOR);
      for (let i = 0; i < 5; i++)
        c.lineTo(x + (i % 2 ? 20 : -20), FLOOR - 7 - i * 7);
      c.stroke();
      round(c, x - 32, FLOOR - 38, 64, 12, 5, "#ffba5a");
    } else if (t.kind === "ice") {
      round(c, x - 58, FLOOR - 4, 116, 13, 5, "#a7f4ff");
      c.fillStyle = "#e2ffff";
      c.font = "24px sans-serif";
      c.fillText("✧", x, FLOOR - 14);
    } else if (t.kind === "crumble") {
      round(
        c,
        x - 43,
        FLOOR,
        86,
        t.brokenUntil > state.time ? 75 : 16,
        5,
        t.brokenUntil > state.time ? "#102e3c" : "#f49f7e",
      );
      c.strokeStyle = "#8b5049";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x - 8, FLOOR);
      c.lineTo(x + 3, FLOOR + 7);
      c.lineTo(x - 4, FLOOR + 16);
      c.stroke();
    } else {
      c.save();
      c.translate(x, FLOOR - 125);
      c.rotate(Math.sin(state.time / 290 + t.slot) * 0.85);
      round(c, -5, 0, 10, 90, 4, "#e0c0a5");
      round(c, -35, 75, 70, 34, 9, "#fa8d94");
      round(c, -29, 78, 58, 8, 4, "#ffb2b0");
      c.restore();
      round(c, x - 7, FLOOR - 134, 14, 14, 7, "#ffdc9b");
    }
  });
  state.players.forEach((p, i) => {
    let at = memory.positions.get(p.id);
    if (!at || Math.abs(at.x - p.x) > 220) {
      at = { x: p.x, y: p.y };
      memory.positions.set(p.id, at);
    }
    const factor = 1 - Math.exp(-dt * 22);
    at.x += (p.x - at.x) * factor;
    at.y += (p.y - at.y) * factor;
    drawRunner(c, p, i, at.x, at.y, p.id === self, now, reduced);
  });
  c.restore();
}
function drawRunner(
  c: CanvasRenderingContext2D,
  p: Runner,
  i: number,
  x: number,
  y: number,
  self: boolean,
  now: number,
  reduced: boolean,
) {
  const stretch = reduced
    ? 1
    : Math.max(0.84, Math.min(1.19, 1 + Math.abs(p.vy) / 4000));
  c.fillStyle = "#102e3c3d";
  c.beginPath();
  c.ellipse(x, FLOOR + 3, 22, 6, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.translate(x, y - 23);
  c.rotate(reduced ? 0 : Math.max(-0.18, Math.min(0.18, p.vx / 2600)));
  c.scale(1 / stretch, stretch);
  const bounce =
    p.grounded && !reduced
      ? Math.sin(now / 65 + i) * Math.min(3, Math.abs(p.vx) / 80)
      : 0;
  round(c, -20, -24 + bounce, 40, 46, 17, COLORS[i % COLORS.length]!);
  round(c, -15, -20 + bounce, 23, 9, 5, "#ffffff45");
  const look = p.vx < 0 ? -3 : 3;
  round(c, -10 + look, -9 + bounce, 7, 10, 3, "#163744");
  round(c, 4 + look, -9 + bounce, 7, 10, 3, "#163744");
  c.strokeStyle = "#163744";
  c.lineWidth = 2;
  c.beginPath();
  c.arc(look, 3 + bounce, 5, 0, Math.PI);
  c.stroke();
  round(c, -19, 17, 14, 8, 4, "#163744");
  round(c, 5, 17, 14, 8, 4, "#163744");
  c.restore();
  c.textAlign = "center";
  c.font = `${self ? "800" : "600"} 14px Inter, sans-serif`;
  const label = self ? "YOU" : p.name.slice(0, 12);
  const w = c.measureText(label).width + 18;
  round(c, x - w / 2, y - 79, w, 24, 8, self ? "#fff2cf" : "#163744dd");
  c.fillStyle = self ? "#163744" : "#fff2cf";
  c.fillText(label, x, y - 62);
  if (p.finished) {
    c.fillStyle = "#fff2cf";
    c.fillText("✓", x, y - 89);
  }
}
