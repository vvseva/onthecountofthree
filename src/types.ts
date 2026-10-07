export type SyncRole = 'PRIMARY' | 'SECONDARY';

export type SyncEventType =
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'PING'
  | 'PONG'
  | 'ANNOUNCE'
  | 'COUNTDOWN_START'
  | 'COUNTDOWN_ABORT'
  | 'CHAT_MESSAGE'
  | 'ROLE_CHANGE'
  | 'AUDIO_DECODED';

export interface ChatMessagePayload {
  id: string;
  senderId: string;
  timestamp: number;
  text: string;
}

export interface SyncPayload {
  version: 1;
  senderId: string;           // 8-character unique session token for this client
  sequenceId: number;         // Monotonically increasing sequence number
  timestamp: number;          // Sender Date.now()
  type: SyncEventType;
  playbackTime: number;       // Video currentTime in seconds
  playbackRate: number;       // Video playbackRate
  paused: boolean;            // Whether the video is currently paused
  fingerprint?: string;       // 8-character file fingerprint (e.g., A7C2-9F10)
  duration?: number;          // Video total duration in seconds
  pingNonce?: string;         // Token echoed in PONG
  echoTimestamp?: number;     // Original ping timestamp returned in PONG
  targetStartTime?: number;   // Timestamp for synchronized countdown play
  chatMessage?: ChatMessagePayload;
  pausedBy?: string;          // Identifier of user who initiated pause
  role?: SyncRole;            // Sync role: PRIMARY (master clock) or SECONDARY (follower)
  audioDecodedTrack?: string; // Notification of completed audio decode
}

export type RelayConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface RelayStatus {
  url: string;
  status: RelayConnectionStatus;
  eventsSent: number;
  eventsReceived: number;
  latencyMs?: number;
  lastError?: string;
}

export interface PeerState {
  peerId: string;
  lastSeen: number;
  fingerprint?: string;
  playbackTime: number;
  paused: boolean;
  playbackRate: number;
  rttMs: number;
  estimatedClockSkewMs: number;
  role?: SyncRole;
  isAudioDecoded?: boolean;
}

export type FingerprintMatchStatus = 'NO_LOCAL_FILE' | 'WAITING_FOR_PEER' | 'VERIFIED' | 'MISMATCH';
