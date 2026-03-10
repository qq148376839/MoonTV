/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * MoonTV Android TV JS Bridge type declarations.
 *
 * The Android shell injects `window.MoonTvBridge` via @JavascriptInterface.
 * When running outside the Android shell (e.g. Chrome on desktop) these
 * methods will not exist, and `isAndroidTv()` returns false.
 */

export interface MoonTvBridge {
  /** Launch native ExoPlayer with the given m3u8 URL */
  playVideo(url: string, title: string, subtitle: string): void;
  /** Returns true when running inside the Android TV shell */
  isAndroidTv(): boolean;
  /** Returns the server base URL configured by the user on first launch */
  getServerUrl(): string;
}

/**
 * Callback invoked by native code when ExoPlayer finishes or the user exits.
 * `currentTime` and `duration` are in seconds.
 */
export type NativePlaybackEndCallback = (
  currentTime: number,
  duration: number
) => void;

// Extend the global Window type
declare global {
  interface Window {
    MoonTvBridge?: MoonTvBridge;
    onNativePlaybackEnd?: NativePlaybackEndCallback;
  }
}

/** Convenience: check whether we are running inside the Android TV shell */
export function isAndroidTv(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MoonTvBridge?.isAndroidTv === 'function' &&
    window.MoonTvBridge.isAndroidTv()
  );
}

/**
 * Play a video via native ExoPlayer (if available) or return false so the
 * caller can fall back to an in-browser player.
 */
export function playViaNative(
  url: string,
  title: string,
  subtitle: string
): boolean {
  if (isAndroidTv() && window.MoonTvBridge) {
    window.MoonTvBridge.playVideo(url, title, subtitle);
    return true;
  }
  return false;
}
