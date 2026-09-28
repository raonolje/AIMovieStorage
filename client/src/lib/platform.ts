/** The bundled Python workers currently target Windows/CUDA. */
export function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent);
}
