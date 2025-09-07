import path from "path";
import { CONFIG } from "../config.js";

export function assertAllowedPath(targetPath: string) {
  const absTarget = path.resolve(process.cwd(), targetPath);
  const ok = CONFIG.allowedDirs.some(dir => {
    const base = path.resolve(process.cwd(), dir);
    return absTarget === base || absTarget.startsWith(base + path.sep);
  });
  if (!ok) throw new Error(`Acceso denegado fuera de whitelist: ${targetPath}`);
  return absTarget;
}