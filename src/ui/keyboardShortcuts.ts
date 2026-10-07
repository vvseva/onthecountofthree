/**
 * Accessible Keyboard Shortcuts Manager
 * Space: Play/Pause
 * Left/Right: Seek ±5s
 * Up/Down: Volume ±5%
 * F: Fullscreen
 * M: Mute toggle
 * C: Toggle Controls bar visibility
 * T: Open and focus chat input
 * ? or H or F1: Toggle Shortcuts Help modal
 * Escape: Dismiss modals or blur active focus
 */

export interface KeyboardActions {
  onTogglePlayPause: () => void;
  onSeekRelative: (seconds: number) => void;
  onVolumeChange: (delta: number) => void;
  onToggleFullscreen: () => void;
  onToggleMute: () => void;
  onToggleControls?: () => void;
  onFocusChat?: () => void;
  onToggleHelp?: () => void;
  onEscape?: () => void;
}

export function setupKeyboardShortcuts(actions: KeyboardActions): () => void {
  const handler = (e: KeyboardEvent) => {
    // 1. If typing into an input/textarea/select, only handle Escape to blur
    const target = e.target as HTMLElement | null;
    const isTextInput =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    if (e.key === 'Escape') {
      if (isTextInput && target) {
        target.blur();
      }
      if (actions.onEscape) {
        actions.onEscape();
      }
      return;
    }

    if (isTextInput) {
      return;
    }

    // 2. Suppress media actions if a modal dialog is currently open
    const hasOpenModal = document.querySelector('.modal-backdrop') !== null;
    if (hasOpenModal) {
      return;
    }

    // 3. Hotkeys dispatch
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

      case 'KeyC':
        e.preventDefault();
        if (actions.onToggleControls) {
          actions.onToggleControls();
        }
        break;

      case 'KeyT':
        e.preventDefault();
        if (actions.onFocusChat) {
          actions.onFocusChat();
        }
        break;

      case 'KeyH':
      case 'F1':
        e.preventDefault();
        if (actions.onToggleHelp) {
          actions.onToggleHelp();
        }
        break;

      case 'Slash':
        if (e.shiftKey) { // '?' key
          e.preventDefault();
          if (actions.onToggleHelp) {
            actions.onToggleHelp();
          }
        }
        break;
    }
  };

  window.addEventListener('keydown', handler);
  return () => {
    window.removeEventListener('keydown', handler);
  };
}
