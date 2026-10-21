export interface DeviceInfo {
  isTouch: boolean;
  isIOS: boolean;
  isMobile: boolean;
  dpr: number;
}

export function detectDevice(): DeviceInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent || "";
  // iPadOS reports itself as Mac; detect via touch points.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const isTouch = coarse || nav.maxTouchPoints > 0 || "ontouchstart" in window;
  const isMobile = isIOS || /Android|Mobile/i.test(ua) || (coarse && Math.min(screen.width, screen.height) < 820);
  return { isTouch, isIOS, isMobile, dpr: window.devicePixelRatio || 1 };
}

/** Returns null if WebGL is usable, otherwise a human-readable reason. */
export function checkWebGL(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "Your browser could not create a WebGL context.";
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return null;
  } catch (e) {
    return "WebGL initialisation failed: " + (e instanceof Error ? e.message : String(e));
  }
}
