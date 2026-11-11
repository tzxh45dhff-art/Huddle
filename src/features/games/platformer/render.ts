import {
  LEVELS,
  solidAt,
  enemyAt,
} from "../../../../server/src/games/platformer.physics";
import type { Adventure } from "../../../../server/src/games/platformer.physics";
import { drawSprite } from "./spriteArt";
export type Camera = {
  x: number;
  level: number;
  positions: Map<string, { x: number; y: number }>;
};
function rect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}
export function render(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: Adventure,
  self: string | undefined,
  m: Camera,
  dt: number,
  reduced: boolean,
) {
  const level = LEVELS[s.level]!,
    virtualW = w < 650 ? 320 : Math.max(520, Math.min(800, (w / h) * 300)),
    scale = w / virtualW,
    virtualH = h / scale;
  const you = s.players.find((p) => p.id === self),
    focus =
      (you && !you.finished
        ? you
        : s.players.filter((p) => !p.finished).sort((a, b) => b.x - a.x)[0]) ??
      you ??
      s.players[0]!;
  const target = Math.max(
    0,
    Math.min(level.width - virtualW, focus.x - virtualW * 0.32),
  );
  if (m.level !== s.level) {
    m.x = target;
    m.level = s.level;
    m.positions.clear();
  }
  m.x += (target - m.x) * (1 - Math.exp(-dt * 10));
  const cameraY = Math.max(-320, Math.min(180, 400 - virtualH * 0.77));
  const cave = level.theme === "cavern",
    sky = level.theme === "sky";
  rect(c, 0, 0, w, h, cave ? "#192449" : sky ? "#8897e8" : "#78bbed");
  c.save();
  c.scale(scale, scale);
  c.translate(0, -cameraY);
  // Pixel scenery uses only flat, tiled shapes; no blurred layers or vector gradients.
  if (cave) {
    for (let i = 0; i < 24; i++) {
      const x = (i * 149 - m.x * 0.25) % (virtualW + 160);
      rect(c, x, 80 + (i % 3) * 36, 12, 52, "#253765");
      rect(c, x + 3, 86 + (i % 3) * 36, 3, 30, "#7184c7");
    }
  } else {
    for (let i = 0; i < 14; i++) {
      const x = i * 210 - m.x * 0.3;
      rect(c, x + 12, 100 + (i % 3) * 33, 54, 18, "#fff6e6");
      rect(c, x + 24, 88 + (i % 3) * 33, 30, 12, "#fff6e6");
      rect(c, x, 108 + (i % 3) * 33, 78, 10, "#fff6e6");
    }
    // Distant peaks and closer rounded hills move at different depths.
    for (let i = 0; i < 16; i++) {
      const x = i * 220 - m.x * 0.18,
        top = 180 + (i % 3) * 26;
      for (let y = top; y < 384; y += 8) {
        const spread = Math.min(95, (y - top) * 0.7 + 12);
        rect(
          c,
          x + 100 - spread,
          y,
          spread * 2,
          8,
          sky ? "#7378c7" : "#86cda1",
        );
      }
      rect(c, x + 90, top + 14, 20, 5, sky ? "#a4abe8" : "#b5e5b4");
    }
    for (let i = 0; i < 18; i++) {
      const x = i * 180 - m.x * 0.4,
        top = 258 + (i % 3) * 23;
      for (let y = top; y < 384; y += 6) {
        const spread = Math.min(63, 18 + Math.sqrt((y - top) * 55));
        rect(c, x + 64 - spread, y, spread * 2, 6, sky ? "#5964a6" : "#419b70");
      }
      for (let y = top + 6; y < 384; y += 6) {
        const spread = Math.min(54, 12 + Math.sqrt((y - top) * 40));
        rect(c, x + 58 - spread, y, spread * 2, 6, sky ? "#7c87c7" : "#68b97d");
      }
      rect(c, x + 47, top + 26, 4, 9, sky ? "#424a86" : "#2c7455");
      rect(c, x + 69, top + 26, 4, 9, sky ? "#424a86" : "#2c7455");
    }
  }

  c.translate(-Math.round(m.x), 0);
  if (!cave) {
    for (
      let x = Math.floor(m.x / 120) * 120;
      x < m.x + virtualW + 100;
      x += 120
    ) {
      if (
        !level.solids.some(
          (t) => t.kind === "ground" && x > t.x + 20 && x + 24 < t.x + t.w,
        )
      )
        continue;
      const tint = sky ? "#7d95be" : "#287b51";
      rect(c, x, 378, 24, 6, tint);
      rect(c, x + 4, 374, 5, 7, tint);
      rect(c, x + 14, 370, 5, 11, tint);
      if (x % 240 === 0) {
        rect(c, x + 37, 371, 2, 13, "#368152");
        rect(c, x + 33, 369, 10, 4, "#fff2be");
        rect(c, x + 36, 366, 4, 10, "#fff2be");
        rect(c, x + 36, 369, 4, 4, "#eda650");
      }
    }
  }
  for (const base of level.solids) {
    if (s.broken.includes(base.id)) continue;
    const tile = solidAt(base, s.time);
    if (tile.x + tile.w < m.x - 40 || tile.x > m.x + virtualW + 40) continue;
    if (tile.kind === "ground") {
      const depth = Math.max(tile.h, virtualH + cameraY - tile.y + 10);
      rect(c, tile.x, tile.y, tile.w, depth, cave ? "#4a477d" : "#ae6949");
      for (let x = tile.x; x < tile.x + tile.w; x += 32) {
        rect(c, x, tile.y, 32, 7, cave ? "#8588ba" : "#85d852");
        rect(c, x + 3, tile.y + 7, 26, 4, cave ? "#5d6293" : "#3c8b48");
        for (let y = tile.y + 16; y < tile.y + depth; y += 32) {
          rect(c, x + 4, y, 9, 5, cave ? "#343456" : "#7f493e");
          rect(c, x + 20, y + 12, 7, 5, cave ? "#69699c" : "#d38b58");
        }
      }
    } else if (tile.kind === "pipe") {
      rect(c, tile.x + 4, tile.y + 12, tile.w - 8, tile.h - 12, "#206e50");
      rect(c, tile.x + 8, tile.y + 12, 12, tile.h - 12, "#8bd35a");
      rect(c, tile.x + 20, tile.y + 12, 24, tile.h - 12, "#43ab59");
      rect(c, tile.x, tile.y, tile.w, 16, "#174944");
      rect(c, tile.x + 3, tile.y + 3, tile.w - 6, 10, "#58bb5b");
      rect(c, tile.x + 6, tile.y + 3, 11, 10, "#b6e875");
    } else if (tile.kind === "platform") {
      rect(
        c,
        tile.x,
        tile.y,
        tile.w,
        8,
        sky ? "#f7eeec" : cave ? "#9bb0eb" : "#e89c63",
      );
      rect(
        c,
        tile.x + 3,
        tile.y + 8,
        tile.w - 6,
        6,
        sky ? "#c9caeb" : cave ? "#5c77ba" : "#a65b43",
      );
      for (let x = tile.x + 7; x < tile.x + tile.w; x += 16)
        rect(c, x, tile.y + 2, 3, 3, "#fff4d3");
    } else
      for (let x = tile.x; x < tile.x + tile.w; x += 32) {
        const used = s.used.includes(tile.id);
        rect(c, x, tile.y, 32, 32, "#543b45");
        rect(
          c,
          x + 2,
          tile.y + 2,
          28,
          28,
          used ? "#9a8071" : tile.kind === "brick" ? "#be704f" : "#f7bc4c",
        );
        rect(c, x + 4, tile.y + 4, 24, 2, used ? "#bca08a" : "#ffdd7b");
        if (tile.kind === "brick") {
          rect(c, x + 2, tile.y + 15, 28, 2, "#713e38");
          rect(c, x + 15, tile.y + 2, 2, 13, "#713e38");
          rect(c, x + 8, tile.y + 17, 2, 13, "#713e38");
          rect(c, x + 24, tile.y + 17, 2, 13, "#713e38");
        } else if (!used) {
          c.font = "32px Huddle Pixel, monospace";
          c.textAlign = "center";
          c.fillStyle = "#805238";
          c.fillText("?", x + 17, tile.y + 26);
          c.fillStyle = "#fff0a5";
          c.fillText("?", x + 16, tile.y + 24);
        }
      }
  }
  for (const coin of level.coins) {
    if (
      s.collected.includes(coin.id) ||
      coin.x < m.x - 20 ||
      coin.x > m.x + virtualW + 20
    )
      continue;
    const width = reduced ? 8 : 3 + Math.abs(Math.sin(s.time / 130)) * 7;
    rect(c, coin.x - width / 2, coin.y - 7, width, 14, "#a56a28");
    rect(
      c,
      coin.x - width / 2 + 1,
      coin.y - 7,
      Math.max(1, width - 2),
      12,
      "#ffd95e",
    );
    rect(c, coin.x - 1, coin.y - 4, 2, 6, "#fff4b6");
  }
  for (const checkpoint of level.checkpoints) {
    rect(c, checkpoint, 336, 3, 48, "#f7efd8");
    rect(
      c,
      checkpoint + 3,
      336,
      22,
      14,
      (you?.checkpoint ?? 0) >= checkpoint ? "#ffc95c" : "#df8ba0",
    );
  }
  for (const enemy of level.enemies) {
    if (s.defeated.includes(enemy.id)) continue;
    const e = enemyAt(enemy, s.time);
    if (e.x < m.x - 40 || e.x > m.x + virtualW + 40) continue;
    const step = reduced ? 0 : Math.sin(s.time / 70) * 2;
    rect(
      c,
      e.x - 13,
      e.y - 17,
      26,
      13,
      enemy.kind === "slime" ? "#ad76c4" : "#b26350",
    );
    rect(
      c,
      e.x - 9,
      e.y - 23,
      18,
      6,
      enemy.kind === "slime" ? "#c79be0" : "#de9472",
    );
    rect(c, e.x - 9, e.y - 15, 5, 6, "#fff2de");
    rect(c, e.x + 4, e.y - 15, 5, 6, "#fff2de");
    rect(c, e.x - 6, e.y - 13, 2, 4, "#233448");
    rect(c, e.x + 4, e.y - 13, 2, 4, "#233448");
    rect(c, e.x - 13 + step, e.y - 4, 10, 4, "#303149");
    rect(c, e.x + 4 - step, e.y - 4, 10, 4, "#303149");
  }
  const flag = level.flag;
  rect(c, flag, 208, 4, 176, "#eff9dc");
  rect(c, flag - 3, 202, 10, 8, "#ffd15e");
  rect(c, flag + 4, 214, 36, 24, "#ee7e83");
  rect(c, flag + 10, 219, 8, 8, "#fff5dc");
  rect(c, flag + 80, 288, 96, 96, "#bd9ea0");
  rect(c, flag + 76, 280, 104, 16, "#f5d1b7");
  for (let x = flag + 80; x < flag + 176; x += 24)
    rect(c, x, 264, 14, 16, "#f5d1b7");
  rect(c, flag + 112, 336, 32, 48, "#56435a");
  rect(c, flag + 118, 330, 20, 6, "#56435a");
  for (const p of s.players) {
    let pos = m.positions.get(p.id);
    if (!pos || Math.abs(pos.x - p.x) > 180 || Math.abs(pos.y - p.y) > 200) {
      pos = { x: p.x, y: p.y };
      m.positions.set(p.id, pos);
    }
    const t = 1 - Math.exp(-dt * (p.id === self ? 55 : 25));
    pos.x += (p.x - pos.x) * t;
    pos.y += (p.y - pos.y) * t;
    if (p.immune > s.time && Math.floor(s.time / 90) % 2 === 0)
      c.globalAlpha = 0.45;
    drawSprite(
      c,
      p.character,
      pos.x,
      pos.y,
      p.grounded && Math.abs(p.vx) > 15 && !reduced
        ? Math.floor(s.time / 90)
        : 0,
      p.vx < 0 ? -1 : 1,
      p.power > s.time && Math.floor(s.time / 130) % 3 === 0,
    );
    c.globalAlpha = 1;
    c.font = "bold 8px monospace";
    c.textAlign = "center";
    c.fillStyle = p.id === self ? "#fff5b7" : "#fff";
    c.strokeStyle = "#253552";
    c.lineWidth = 3;
    c.strokeText(
      p.id === self ? "YOU" : p.name.slice(0, 10),
      pos.x,
      pos.y - 38,
    );
    c.fillText(p.id === self ? "YOU" : p.name.slice(0, 10), pos.x, pos.y - 38);
    const age = s.time - p.effectAt;
    if (
      age >= 0 &&
      age < 450 &&
      !reduced &&
      ["coin", "power", "stomp", "finish", "fall"].includes(p.effect)
    ) {
      c.globalAlpha = 1 - age / 450;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2,
          r = 8 + age / 15;
        rect(
          c,
          pos.x + Math.cos(a) * r,
          pos.y - 15 + Math.sin(a) * r - age / 40,
          3,
          3,
          k % 2 ? "#fff7d0" : "#ffda58",
        );
      }
      c.globalAlpha = 1;
      if (p.effect === "coin" || p.effect === "stomp") {
        c.fillStyle = "#fff1ac";
        c.fillText(
          p.effect === "coin" ? "+100" : "+200",
          pos.x,
          pos.y - 45 - age / 30,
        );
      }
    }
  }
  c.restore();
}
