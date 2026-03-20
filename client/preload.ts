/**
 * Preload: polyfill globalThis.crypto for Node < 20 and tsx CJS mode.
 * Must run before @x402/evm imports (which use globalThis.crypto.getRandomValues).
 */
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}
