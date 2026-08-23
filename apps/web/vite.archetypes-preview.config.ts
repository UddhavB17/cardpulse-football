// Dev-only: bundles the artwork module to plain ESM so scripts can render
// archetype previews with Node (see scripts/render-archetypes.mjs).
//
//   pnpm -C apps/web exec vite build --config vite.archetypes-preview.config.ts
//   node apps/web/scripts/render-archetypes.mjs \
//     apps/web/archetype-preview/artwork.bundle.mjs apps/web/archetype-preview/out
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "archetype-preview",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: "src/football/artwork.ts",
      formats: ["es"],
      fileName: () => "artwork.bundle.mjs",
    },
  },
});
