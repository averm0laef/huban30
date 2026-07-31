import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(packageDirectory, "dist");

if (path.dirname(outputDirectory) !== packageDirectory || path.basename(outputDirectory) !== "dist") {
  throw new Error("Refusing to clean an unexpected build output path");
}

rmSync(outputDirectory, { force: true, recursive: true });
