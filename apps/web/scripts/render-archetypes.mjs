// Dev-only render evidence generator (not shipped): renders each archetype
// edition to standalone SVG plus an HTML contact sheet.
//
// Usage:
//   pnpm exec esbuild apps/web/src/football/artwork.ts \
//     --bundle --format=esm --outfile=/tmp/artwork.bundle.mjs
//   node apps/web/scripts/render-archetypes.mjs /tmp/artwork.bundle.mjs ./out
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const bundle = process.argv[2];
const outDir = process.argv[3] ?? ".";
if (bundle === undefined) {
  console.error("usage: node render-archetypes.mjs <bundled-artwork.mjs> [outDir]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const mod = await import(bundle);
const cases = [
  { playerId: "demo:haaland", playerName: "Erling Haaland", position: "forward", uniqueKey: "2025/26" },
  { playerId: "demo:rodri", playerName: "Rodri", position: "midfielder", uniqueKey: "2025/26" },
  { playerId: "demo:fwd", playerName: "Academy Striker", position: "forward", uniqueKey: "2025/26" },
  { playerId: "demo:mid", playerName: "Academy Engine", position: "midfielder", uniqueKey: "2025/26" },
  { playerId: "demo:def", playerName: "Academy Wall", position: "defender", uniqueKey: "2025/26" },
  { playerId: "demo:gk", playerName: "Academy Keeper", position: "goalkeeper", uniqueKey: "2025/26" },
  { playerId: "demo:unknown", playerName: "Zalt Ibbara", position: null, uniqueKey: "2025/26" },
];

const cards = cases.map((input, index) => {
  const plan = mod.athleteArtworkPlan(input);
  writeFileSync(join(outDir, `archetype-${index}-${plan.archetype.id}.svg`), plan.svg);
  return {
    title: plan.archetype.editorialTitle,
    id: plan.archetype.id,
    bytes: plan.svg.length,
    svg: plan.svg,
    input,
  };
});

console.table(cards.map(({ title, id, bytes }) => ({ id, title, svgBytes: bytes })));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{background:#171310;color:#f5efe2;font-family:ui-monospace,monospace;display:flex;gap:24px;padding:32px;flex-wrap:wrap}
  figure{margin:0;width:220px}figcaption{font-size:11px;margin-top:8px;line-height:1.5}
  .card{width:220px;height:300px;background:#f5efe2;color:#171310;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.45);overflow:hidden}
</style></head><body>
${cards
  .map(
    (c) => `<figure><div class="card">${c.svg}</div><figcaption><strong>${c.title}</strong><br>${c.id}<br>${c.bytes} B</figcaption></figure>`,
  )
  .join("\n")}
</body></html>`;
writeFileSync(join(outDir, "archetype-gallery.html"), html);
console.log(`wrote ${join(outDir, "archetype-gallery.html")}`);
