/**
 * Safari < 15.4 compatibility polyfills.
 *
 * This file must be the very first import in app/_layout.tsx so that the
 * polyfills are in place before any library code (e.g. react-native-reanimated)
 * that uses these APIs.
 */

// structuredClone — Safari 15.4+ only; Reanimated uses it for animation state copies.
if (typeof globalThis.structuredClone === 'undefined') {
  (globalThis as any).structuredClone = function structuredClone<T>(obj: T): T {
    if (obj === undefined) return obj;
    return JSON.parse(JSON.stringify(obj));
  };
}
