import { resolve, relative, sep } from "node:path";
import { isOutsideDirectory } from "./backup-archive.mjs";
export function backupLocations(root, input) {
  const keyFile = resolve(input.keyFile),
    outputDirectory = resolve(input.outputDirectory),
    escrowDirectory = resolve(input.escrowDirectory);
  for (const dir of [outputDirectory, escrowDirectory]) {
    if (
      !isOutsideDirectory(root, dir) &&
      !relative(root, dir).startsWith("data" + sep)
    )
      throw new Error(
        "Backup output must be ignored data or outside the repository",
      );
    if (!isOutsideDirectory(dir, keyFile))
      throw new Error("Key file must be kept separately");
  }
  if (!isOutsideDirectory(outputDirectory, escrowDirectory))
    throw new Error("Escrow must be separate from the archive directory");
  return { keyFile, outputDirectory, escrowDirectory };
}
