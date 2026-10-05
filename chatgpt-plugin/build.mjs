import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile("src/index.js", "dist/server/index.js");
await copyFile("src/tools.mjs", "dist/server/tools.mjs");
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
