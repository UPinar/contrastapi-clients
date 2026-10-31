/**
 * Declares randomBytes, the only node:crypto call the extension uses.
 * The project has no @types/node.
 * Without this file, tsc cannot type `import * as crypto from "crypto"` (error TS2591).
 */
declare module "crypto" {
  export function randomBytes(size: number): { toString(encoding: "hex"): string };
}
