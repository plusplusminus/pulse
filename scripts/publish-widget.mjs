// Copies the built widget bundles into public/widget/v1 so the Pulse app serves them
// at /widget/v1/pulse.js and /widget/v1/pulse-loader.js. Run via `pnpm widget:publish`
// (part of `pnpm build`). public/widget/ is gitignored — it is build output.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "packages/feedback-widget/dist");
const out = resolve(root, "public/widget/v1");

const files = [
  ["embed.global.js", "pulse.js"],
  ["embed.global.js.map", "pulse.js.map"],
  // Lazily fetched by the embed on first viewport capture (PULSE-397). The URL
  // is derived from the widget's own API base, so it must sit next to pulse.js.
  ["capture-engine.global.js", "capture-engine.js"],
  ["capture-engine.global.js.map", "capture-engine.js.map"],
  ["pulse-loader.global.js", "pulse-loader.js"],
];

mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const src = resolve(dist, from);
  if (!existsSync(src)) {
    console.error(`publish-widget: missing ${src} — run pnpm widget:build first`);
    process.exit(1);
  }
  copyFileSync(src, resolve(out, to));
  console.log(`publish-widget: ${from} -> public/widget/v1/${to}`);
}
