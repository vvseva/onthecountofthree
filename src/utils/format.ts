/**
 * Utility: Unified Time & Playback Formatter
 * Standardizes time strings across player UI, diagnostics, and protocol logs.
 * Supports auto-scaling hours (H:MM:SS) for feature-length media and M:SS for short clips.
 */

export function formatPlaybackTime(seconds: number, forceHours = false): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const totalSec = Math.floor(seconds);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0 || forceHours) {
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatTimeWithMs(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const base = formatPlaybackTime(seconds, false);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${base}.${ms.toString().padStart(3, '0')}`;
}
