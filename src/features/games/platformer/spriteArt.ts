// Original 16 × 20 sprites. Transparent spaces preserve a crisp pixel silhouette at any scale.
const bodies = [
  [
    "  OO        OO  ",
    "  OYO      OYO  ",
    "  OYYOOOOOOYYO  ",
    "  OYYYYYYYYYYO  ",
    " OYYYYYYYYYYYYO ",
    " OYYWWYYYYWWYYO ",
    " OYWWKWWWWKWWYO ",
    " OYWWWKWWKWWWYO ",
    "  OWWWWKKWWWWO  ",
    "   OWWWWWWWWO   ",
  ],
  [
    "    PP    PP    ",
    "   PRRP  PRRP   ",
    "   PRRP  PRRP   ",
    "   PRRP  PRRP   ",
    "   PPPPPPPPPP   ",
    "  PPPPPPPPPPPP  ",
    "  PPWKPPPPKWPP  ",
    "  PPWKPPPPKWPP  ",
    "   PWWWWKWWWP   ",
    "    PWWWWWWP    ",
  ],
  [
    "  BBBB    BBBB  ",
    " BBTBBB  BBBTBB ",
    " BBBBBBBBBBBBBB ",
    "  BBBBBBBBBBBB  ",
    "  BBBBBBBBBBBB  ",
    "  BBWKBBBBKWBB  ",
    "  BBWKBBBBKWBB  ",
    "   BBTTTTTTBB   ",
    "   BTTTKKTTTB   ",
    "    BTTTTTTB    ",
  ],
  [
    "   GGG    GGG   ",
    "  GWWWG  GWWWG  ",
    "  GWKWGGGGWKWG  ",
    "  GWKWGGGGWKWG  ",
    "  GGGGGGGGGGGG  ",
    " GGGGGGGGGGGGGG ",
    " GGGGGGGGGGGGGG ",
    "  GGGKKKKKKGGG  ",
    "   GGGGGGGGGG   ",
    "    GGGGGGGG    ",
  ],
  [
    "  CC        CC  ",
    "  CRC      CRC  ",
    "  CRCC    CCRC  ",
    "  CCCCCCCCCCCC  ",
    " CCCCCCCCCCCCCC ",
    " CCWKCCCCCCKWCC ",
    " CCWKCCCCCCKWCC ",
    "  CCCWWWWWWCCC  ",
    " KCCWWWKKWWWCCK ",
    "   CCWWWWWWCC   ",
  ],
  [
    "       R        ",
    "       K        ",
    "   YYYYYYYYYY   ",
    "  YYYYYYYYYYYY  ",
    "  YYKKKKKKKKYY  ",
    "  YYKGKKKKGKYY  ",
    "  YYKGKKKKGKYY  ",
    "  YYKKKKKKKKYY  ",
    "  YYYKKKKKKYYY  ",
    "   YYYYYYYYYY   ",
  ],
];
const lower = [
  "   AAAAAAAAAA   ",
  "  AAAAWWWWAAAA  ",
  " AAAAWWWWWWAAAA ",
  " AAAAWWWWWWAAAA ",
  "  AAAWWWWWWAAA  ",
  "   AAAAAAAAAA   ",
  "    AAAAAAAA    ",
  "   KKK    KKK   ",
  "  KKKK    KKKK  ",
  "                ",
];
export const palette: Record<string, string> = {
  K: "#233448",
  W: "#fff5dc",
  Y: "#f8aa43",
  O: "#b85c2f",
  P: "#c59df4",
  R: "#ef8694",
  B: "#a56742",
  T: "#e4bb84",
  G: "#77bd55",
  C: "#65bfd0",
  A: "#ffbc61",
};
export const SPRITES = bodies.map((head, i) => [
  ...head,
  ...lower.map((row) =>
    row.replaceAll("A", ["Y", "P", "B", "G", "C", "Y"][i]!),
  ),
]);
export function drawSprite(
  c: CanvasRenderingContext2D,
  index: number,
  x: number,
  y: number,
  frame = 0,
  facing = 1,
  flash = false,
) {
  const rows = SPRITES[index % 6]!;
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(facing, 1);
  for (let row = 0; row < rows.length; row++)
    for (let col = 0; col < 16; col++) {
      const char = rows[row]![col];
      if (!char || char === " ") continue;
      const stride =
        row >= 17
          ? frame % 3 === 1
            ? col < 8
              ? -2
              : 2
            : frame % 3 === 2
              ? col < 8
                ? 2
                : -2
              : 0
          : 0;
      c.fillStyle = flash ? "#fff5b8" : (palette[char] ?? "#fff");
      c.fillRect((col - 8) * 1.5 + stride, (row - 20) * 1.5, 1.5, 1.5);
    }
  c.restore();
}
