import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";

export async function buildNative() {
  const root = "build/native";
  await mkdir(`${root}/tools`, { recursive: true });
  const tools = [
    [
      "ecj.jar",
      "https://repo.maven.apache.org/maven2/org/eclipse/jdt/ecj/3.39.0/ecj-3.39.0.jar",
      "01f5a92ac19bb2b3bf85e295a68f2c73c264369109158b566ce9b490af982948",
    ],
    [
      "xposed-api.jar",
      "https://api.xposed.info/de/robv/android/xposed/api/82/api-82.jar",
      "f48c635f1c7469fdec0e00ad2ea0b7a6b2f5b55065784a35b7ca3a84615e8e25",
    ],
    [
      "r8.jar",
      "https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.3.37/r8-8.3.37.jar",
      "59753e70a74f918389cc87f1b7d66b5c0862932559167425708ded159e3de439",
    ],
  ];
  for (const [name, url, hash] of tools) {
    const path = `${root}/tools/${name}`;
    let bytes = await readFile(path).catch(() => null);
    if (!bytes) {
      execFileSync("curl", [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "90",
        "--output",
        path,
        url,
      ]);
      bytes = await readFile(path);
    }
    if (createHash("sha256").update(bytes).digest("hex") !== hash)
      throw new Error(`Native tool checksum mismatch: ${name}`);
  }
  // Compile-only ABI declarations from the public Valenced Plugin API 1.0.0.
  // Signatures were checked against the 1.3.0 release APK. These headers are NOT
  // shipped: the real API and Kotlin runtime are supplied by Valenced's parent loader.
  // This avoids requiring credentials for GitHub Packages or bundling any host classes.
  const headers = {
    "app/valenced/plugins/PluginBuilder.java":
      "package app.valenced.plugins; public class PluginBuilder { public PluginBuilder() {} public void start(kotlin.jvm.functions.Function1<? super PluginScope, kotlin.Unit> block) {} public void stop(kotlin.jvm.functions.Function1<? super PluginScope, kotlin.Unit> block) {} }",
    "app/valenced/plugins/PluginScope.java":
      "package app.valenced.plugins; public interface PluginScope extends app.valenced.xposed.api.HostScope {}",
    "app/valenced/xposed/api/HostScope.java": "package app.valenced.xposed.api; public interface HostScope { ClassLoader getClassLoader(); }",
    "kotlin/Unit.java":
      "package kotlin; public final class Unit { public static final Unit INSTANCE = new Unit(); private Unit() {} }",
    "kotlin/jvm/functions/Function1.java":
      "package kotlin.jvm.functions; public interface Function1<P, R> { R invoke(P value); }",
  };
  const sources = [];
  for (const [name, source] of Object.entries(headers)) {
    const path = `${root}/headers/${name}`;
    await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await writeFile(path, source);
    sources.push(path);
  }
  for (const name of ["abi", "classes", "dex"])
    await rm(`${root}/${name}`, { recursive: true, force: true });
  await mkdir(`${root}/abi`, { recursive: true });
  await mkdir(`${root}/classes`, { recursive: true });
  await mkdir(`${root}/dex`, { recursive: true });
  const compiler = ["-jar", `${root}/tools/ecj.jar`, "-8", "-warn:none"];
  execFileSync("java", [...compiler, "-d", `${root}/abi`, ...sources], {
    stdio: "inherit",
  });
  async function classesJar(directory, destination) {
    const entries = {};
    async function collect(current, prefix = "") {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (entry.isDirectory())
          await collect(`${current}/${entry.name}`, `${prefix}${entry.name}/`);
        else if (entry.name.endsWith(".class"))
          entries[prefix + entry.name] = await readFile(
            `${current}/${entry.name}`,
          );
      }
    }
    await collect(directory);
    await writeFile(destination, zipSync(entries));
  }
  await classesJar(`${root}/abi`, `${root}/host-abi.jar`);
  execFileSync(
    "java",
    [
      ...compiler,
      "-cp",
      `${root}/host-abi.jar:${root}/tools/xposed-api.jar`,
      "-d",
      `${root}/classes`,
      "native/TranscriptSpacing.java",
    ],
    { stdio: "inherit" },
  );
  await classesJar(`${root}/classes`, `${root}/classes.jar`);
  execFileSync(
    "java",
    [
      "-cp",
      `${root}/tools/r8.jar`,
      "com.android.tools.r8.D8",
      "--release",
      "--min-api",
      "24",
      "--classpath",
      `${root}/host-abi.jar`,
      "--classpath",
      `${root}/tools/xposed-api.jar`,
      "--output",
      `${root}/dex`,
      `${root}/classes.jar`,
    ],
    { stdio: "inherit" },
  );
  const names = (await readdir(`${root}/dex`)).filter((name) =>
    /^classes\d*\.dex$/.test(name),
  );
  if (!names.length) throw new Error("D8 generated no native plugin code");
  const entries = {};
  for (const name of names)
    entries[name] = await readFile(`${root}/dex/${name}`);
  const archive = zipSync(entries);
  await writeFile("build/plugin.jar", archive);
  return archive;
}
