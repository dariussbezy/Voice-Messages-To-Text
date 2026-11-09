import { build } from "esbuild";
import { buildNative } from "./build-native.mjs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { createHash } from "node:crypto";
process.chdir(fileURLToPath(new URL(".", import.meta.url)));
await mkdir("build", { recursive: true });
// Cache the official compiler from a fixed revision; keep third-party sources out of this repository.
const revision = "9ea9f9bfc91319e2b18c6b1c9ac0b993f8600c1d";
const compilerHashes = {
  build: "61cbb34f108bc3dd949532876b435f1fcd1818139af3d9d2df62aa5278795d59",
  "generate-index":
    "1973be5b1e7b1df1f49a573b8aef17286b6a55af03d44946f698660380a64f3f",
};
for (const [name, hash] of Object.entries(compilerHashes)) {
  const path = `build/official-${name}.ts`;
  let source = await readFile(path).catch(() => null);
  if (!source) {
    const response = await fetch(
      `https://raw.githubusercontent.com/Valenced/valenced-plugin-cli/${revision}/src/${name}.ts`,
    );
    if (!response.ok)
      throw new Error(
        `Could not download official compiler: ${response.status}`,
      );
    source = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(source).digest("hex") !== hash)
    throw new Error(`Official compiler checksum mismatch: ${name}`);
  await writeFile(path, source);
  await build({
    entryPoints: [path],
    outfile: `build/official-${name}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
}
const { run } = await import("./build/official-build.mjs");
await run([basename(process.cwd()), "--plugins-dir", ".."]);
if (process.exitCode) throw new Error("Official Valenced compiler failed");
const script = await readFile("build/js/index.js", "utf8");
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const archiveName = `Voice-Messages-To-Text-Valenced-${manifest.version}.zip`;
const native = await buildNative();
const archive = zipSync({
  "plugin.jar": native,
  "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  "index.js": strToU8(script),
});
await writeFile("build/voice-messages-to-text.zip", archive);
await writeFile(archiveName, archive);
const base =
  "https://raw.githubusercontent.com/dariussbezy/Voice-Messages-To-Text/refs/heads/main/VMTT";
const { generateIndex } = await import("./build/official-generate-index.mjs");
const config = JSON.parse(await readFile("repo.config.json", "utf8"));
const archives = (await readdir("."))
  .filter((name) => /^Voice-Messages-To-Text-Valenced-.*\.zip$/.test(name))
  .sort();
const index = generateIndex(
  archives.map((file) => ({ file, url: `${base}/${file}` })),
  config,
);
await writeFile("index.json", JSON.stringify(index, null, 2) + "\n");
console.log(
  `Packaged ${manifest.id}@${manifest.version}: ${Buffer.byteLength(script)} JS bytes`,
);
console.log(
  `Generated repository index for ${archives.length} published artifact(s)`,
);
