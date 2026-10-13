// Hand-drawn textures and icons, generated on a canvas when MapLibre first
// asks for them (via the map's "styleimagemissing" event).

import { LAND_COVER_TYPES, PAINTED, PAINTED_INK, type LandCoverType } from "./featureTypes";

const TILE = 48; // CSS px; drawn at 2x for sharp textures
const RATIO = 2;

type Painter = (ctx: CanvasRenderingContext2D, rand: () => number) => void;

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Draw `mark` at n random spots, wrapped so the tile repeats seamlessly. */
function scatter(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  n: number,
  mark: (x: number, y: number, r: () => number) => void,
) {
  for (let i = 0; i < n; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const markSeed = rand() * 1e9;
    for (const dx of [-TILE, 0, TILE]) {
      for (const dy of [-TILE, 0, TILE]) {
        mark(x + dx, y + dy, seeded(markSeed));
      }
    }
  }
}

function stroke(ctx: CanvasRenderingContext2D, color: string, width: number, alpha: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

const jitter = (r: () => number, a: number) => (r() - 0.5) * a;

function landCoverPainter(type: LandCoverType | "ocean"): Painter {
  const { ink } = PAINTED[type];
  switch (type) {
    case "water":
    case "ocean":
      return (ctx, rand) => {
        stroke(ctx, ink, 1, type === "ocean" ? 0.45 : 0.6);
        scatter(ctx, rand, type === "ocean" ? 4 : 6, (x, y, r) => {
          ctx.beginPath();
          ctx.moveTo(x - 5, y);
          ctx.quadraticCurveTo(x - 2.5, y - 2 + jitter(r, 1), x, y);
          ctx.quadraticCurveTo(x + 2.5, y + 2 + jitter(r, 1), x + 5, y);
          ctx.stroke();
        });
      };
    case "wetland":
      return (ctx, rand) => {
        stroke(ctx, ink, 0.9, 0.7);
        scatter(ctx, rand, 9, (x, y, r) => {
          for (const a of [-0.5, 0, 0.5]) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.sin(a + jitter(r, 0.3)) * 4, y - 4.5 + jitter(r, 1));
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(x - 3, y + 0.5);
          ctx.lineTo(x + 3, y + 0.5);
          ctx.stroke();
        });
      };
    case "salt_marsh":
      return (ctx, rand) => {
        stroke(ctx, ink, 0.9, 0.65);
        scatter(ctx, rand, 10, (x, y, r) => {
          ctx.beginPath();
          ctx.moveTo(x - 2.5, y);
          ctx.lineTo(x + 2.5, y + jitter(r, 0.8));
          ctx.stroke();
        });
        ctx.fillStyle = ink;
        scatter(ctx, rand, 14, (x, y) => {
          ctx.beginPath();
          ctx.arc(x, y, 0.6, 0, Math.PI * 2);
          ctx.fill();
        });
      };
    case "flat":
      return (ctx, rand) => {
        stroke(ctx, ink, 0.7, 0.5);
        scatter(ctx, rand, 7, (x, y, r) => {
          // Short cracked-mud strokes.
          ctx.beginPath();
          ctx.moveTo(x - 3, y);
          ctx.lineTo(x, y + jitter(r, 1.5));
          ctx.lineTo(x + 3, y + jitter(r, 1));
          ctx.stroke();
        });
      };
    case "dune":
      return (ctx, rand) => {
        stroke(ctx, ink, 1, 0.55);
        scatter(ctx, rand, 5, (x, y, r) => {
          ctx.beginPath();
          ctx.arc(x, y + 4, 5 + jitter(r, 2), Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        });
      };
    case "beach":
      return (ctx, rand) => {
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.55;
        scatter(ctx, rand, 22, (x, y, r) => {
          ctx.beginPath();
          ctx.arc(x, y, 0.45 + r() * 0.3, 0, Math.PI * 2);
          ctx.fill();
        });
      };
    case "coastal_sage_scrub":
    case "chaparral":
      return (ctx, rand) => {
        const dense = type === "chaparral";
        ctx.fillStyle = ink;
        scatter(ctx, rand, dense ? 16 : 9, (x, y, r) => {
          ctx.globalAlpha = dense ? 0.5 : 0.4;
          ctx.beginPath();
          ctx.ellipse(x, y, 2 + r() * 1.5, 1.6 + r(), r() * 3, 0, Math.PI * 2);
          ctx.fill();
        });
      };
    case "grassland":
      return (ctx, rand) => {
        stroke(ctx, ink, 0.8, 0.6);
        scatter(ctx, rand, 12, (x, y, r) => {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 1 + jitter(r, 1), y - 3.5);
          ctx.moveTo(x + 1.5, y);
          ctx.lineTo(x + 2 + jitter(r, 1), y - 3);
          ctx.stroke();
        });
      };
    case "oak_woodland":
      return (ctx, rand) => {
        scatter(ctx, rand, 6, (x, y, r) => {
          const rad = 3.2 + r() * 1.3;
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = "#3d4a2c";
          ctx.beginPath();
          ctx.arc(x + 1.2, y + 1.2, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
        });
      };
    case "riparian":
      return (ctx, rand) => {
        stroke(ctx, ink, 1, 0.7);
        scatter(ctx, rand, 8, (x, y, r) => {
          for (const dx of [-2.5, 0, 2.5]) {
            ctx.beginPath();
            ctx.moveTo(x, y - 4);
            ctx.quadraticCurveTo(x + dx * 1.2, y - 3, x + dx + jitter(r, 1), y + 2.5);
            ctx.stroke();
          }
        });
      };
    case "open_field":
      return (ctx) => {
        stroke(ctx, ink, 0.8, 0.45);
        for (let i = -TILE; i < TILE * 2; i += 6) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + TILE, TILE);
          ctx.stroke();
        }
      };
  }
}

const paperPainter: Painter = (ctx, rand) => {
  for (let i = 0; i < 220; i++) {
    ctx.globalAlpha = 0.05 + rand() * 0.06;
    ctx.fillStyle = rand() > 0.5 ? "#8a7356" : "#ffffff";
    ctx.fillRect(rand() * TILE, rand() * TILE, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
};

function tile(base: string | null, paint: Painter, seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE * RATIO;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(RATIO, RATIO);
  if (base) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, TILE, TILE);
  }
  paint(ctx, seeded(seed));
  return canvas;
}

function icon(size: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * RATIO;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(RATIO, RATIO);
  draw(ctx);
  return canvas;
}

const ICONS: Record<string, () => HTMLCanvasElement> = {
  // A domed Tongva house (kiiy).
  "icon-village": () =>
    icon(18, (ctx) => {
      ctx.fillStyle = "#c9a77a";
      ctx.strokeStyle = PAINTED_INK.village;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(2.5, 14);
      ctx.quadraticCurveTo(3, 3, 9, 3);
      ctx.quadraticCurveTo(15, 3, 15.5, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PAINTED_INK.village;
      ctx.fillRect(7.6, 9.5, 2.8, 4.5);
    }),
  "icon-adobe": () =>
    icon(16, (ctx) => {
      ctx.fillStyle = "#e3c9a4";
      ctx.strokeStyle = PAINTED_INK.rancho;
      ctx.lineWidth = 1.2;
      ctx.fillRect(3, 6, 10, 7);
      ctx.strokeRect(3, 6, 10, 7);
      ctx.beginPath();
      ctx.moveTo(2, 6.5);
      ctx.lineTo(8, 3);
      ctx.lineTo(14, 6.5);
      ctx.stroke();
    }),
  "icon-spring": () =>
    icon(12, (ctx) => {
      ctx.fillStyle = "#cfe6ee";
      ctx.strokeStyle = PAINTED_INK.spring;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(6, 6, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PAINTED_INK.spring;
      ctx.beginPath();
      ctx.arc(6, 6, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }),
  "icon-landmark": () =>
    icon(8, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = PAINTED_INK.landmark;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(4, 4, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }),
};

/** Canvas for a style image id, or null if it isn't one of ours. */
export function makeStyleImage(id: string): HTMLCanvasElement | null {
  if (id === "paper") return tile(PAINTED_INK.paper, paperPainter, 7);
  if (id.startsWith("lc-")) {
    const type = id.slice(3) as LandCoverType | "ocean";
    if (type !== "ocean" && !LAND_COVER_TYPES.includes(type)) return null;
    return tile(PAINTED[type].base, landCoverPainter(type), id.length * 97);
  }
  return ICONS[id]?.() ?? null;
}

export const STYLE_IMAGE_PIXEL_RATIO = RATIO;

/** Data URL of a land-cover swatch, for the legend. */
export function swatchDataUrl(type: LandCoverType | "ocean"): string {
  return makeStyleImage(`lc-${type}`)?.toDataURL() ?? "";
}

/** Data URL of an icon, for the legend. */
export function iconDataUrl(id: string): string {
  return ICONS[id]?.().toDataURL() ?? "";
}
