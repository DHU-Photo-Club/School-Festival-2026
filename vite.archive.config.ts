import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const location = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
 root: location("./archive-site/"),
 publicDir: false,
 plugins: [svelte(), {
  name: "archive-public-assets",
  async closeBundle() {
   await cp(location("./public/archive/"), location("./dist/archive/archive/"), { recursive: true });
   await cp(location("./public/fonts/"), location("./dist/archive/fonts/"), { recursive: true });
  },
 }],
 build: { outDir: location("./dist/archive/"), emptyOutDir: true },
});
