/**
 * Room Color Theme Generator
 * Deterministically generates an aesthetically harmonious retro window and desktop
 * theme based on the cryptographic Room ID, allowing users in the same room to share
 * the exact same visual identity.
 */

export interface RoomThemeColors {
  hue: number;
  titlebarGrad: string;
  windowBg: string;
  roomBarBg: string;
  desktopBg: string;
  desktopStipple: string;
}

export function computeRoomTheme(roomId: string): RoomThemeColors {
  if (!roomId) {
    return {
      hue: 210,
      titlebarGrad: 'linear-gradient(90deg, #0a246a, #a6caf0)',
      windowBg: '#d4d0c8',
      roomBarBg: '#e8e5dc',
      desktopBg: '#284c68',
      desktopStipple: '#3a648b'
    };
  }

  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    hash = (hash << 5) - hash + roomId.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);
  const hue = positiveHash % 360;

  const titlebarStart = `hsl(${hue}, 68%, 26%)`;
  const titlebarEnd = `hsl(${(hue + 32) % 360}, 56%, 66%)`;
  const titlebarGrad = `linear-gradient(90deg, ${titlebarStart}, ${titlebarEnd})`;

  const windowBg = `hsl(${hue}, 12%, 84%)`;
  const roomBarBg = `hsl(${hue}, 15%, 88%)`;
  const desktopBg = `hsl(${hue}, 36%, 22%)`;
  const desktopStipple = `hsl(${hue}, 36%, 30%)`;

  return {
    hue,
    titlebarGrad,
    windowBg,
    roomBarBg,
    desktopBg,
    desktopStipple
  };
}

export function applyRoomTheme(roomId: string): RoomThemeColors {
  const theme = computeRoomTheme(roomId);
  const root = document.documentElement;

  root.style.setProperty('--bg-titlebar', theme.titlebarGrad);
  root.style.setProperty('--bg-window', theme.windowBg);
  root.style.setProperty('--bg-room-bar', theme.roomBarBg);
  root.style.setProperty('--bg-desktop', theme.desktopBg);
  root.style.setProperty('--desktop-stipple', theme.desktopStipple);

  if (typeof document !== 'undefined' && document.body) {
    document.body.style.backgroundColor = theme.desktopBg;
    document.body.style.backgroundImage = `radial-gradient(${theme.desktopStipple} 1px, transparent 1px)`;
  }

  return theme;
}
