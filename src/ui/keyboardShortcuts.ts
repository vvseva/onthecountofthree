/**
 * Accessible Keyboard Shortcuts Manager
 * Space: Play/Pause
 * Left/Right: Seek ±5s
 * Up/Down: Volume ±5%
 * F: Fullscreen
 * M: Mute toggle
 */

export interface KeyboardActions {
  onTogglePlayPause: () => void;
  onSeekRelative: (seconds: number) => void;
  onVolumeChange: (delta: number) => void;
  onToggleFullscreen: () => void;
  onToggleMute: () => void;
}

export function setupKeyboardShortcuts(actions: KeyboardActions): () => void {
  const handler = (e: KeyboardEvent) => {
    // Ignore keystrokes when typing into input or textarea
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        actions.onTogglePlayPause();
        break;

      case 'ArrowLeft':
        e.preventDefault();
        actions.onSeekRelative(-5);
        break;

      case 'ArrowRight':
        e.preventDefault();
        actions.onSeekRelative(5);
        break;

      case 'ArrowUp':
        e.preventDefault();
        actions.onVolumeChange(0.05);
        break;

      case 'ArrowDown':
        e.preventDefault();
        actions.onVolumeChange(-0.05);
        break;

      case 'KeyF':
        e.preventDefault();
        actions.onToggleFullscreen();
        break;

      case 'KeyM':
        e.preventDefault();
        actions.onToggleMute();
        break;
    }
  };

  window.addEventListener('keydown', handler);
  return () => {
    window.removeEventListener('keydown', handler);
  };
}
