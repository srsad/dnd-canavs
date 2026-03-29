/** Effective flags after merging role defaults + optional overrides (ACL). */
export type RoomParticipantPermissions = {
  editCanvas: boolean;
  moveAnyToken: boolean;
  manageParticipants: boolean;
};

export type ParticipantAclEntry = {
  permissions?: Partial<RoomParticipantPermissions>;
};

/** Persisted overrides per participant id (see `Room.participantAcl`). */
export type ParticipantAcl = Record<string, ParticipantAclEntry>;

export type RoomParticipant = {
  id: string;
  displayName: string;
  kind: 'registered' | 'guest';
  role: 'gm' | 'player';
  userId?: string;
  /** Partial overrides; merged with role defaults via `effectivePermissions`. */
  permissions?: Partial<RoomParticipantPermissions>;
};

/** Server-computed presence for room_state / presence_updated */
export type ParticipantPresence = 'online' | 'offline' | 'away';

export type RoomParticipantWithPresence = RoomParticipant & {
  presence: ParticipantPresence;
};

export type CanvasStrokePoint = {
  x: number;
  y: number;
};

export type CanvasStroke = {
  id: string;
  color: string;
  width: number;
  points: CanvasStrokePoint[];
  authorId: string;
};

export type CanvasToken = {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  size: number;
  /** If set, this participant (and GM) may move the token via `tokens:move`. */
  controlledByParticipantId?: string | null;
};

export type CanvasLayer = {
  id: string;
  name: string;
  visible: boolean;
  strokes: CanvasStroke[];
};

export type CanvasImage = {
  id: string;
  /** Layer id; images stack with layer order (same as strokes). */
  layerId: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type RoomCanvasState = {
  backgroundColor: string;
  gridEnabled: boolean;
  tokens: CanvasToken[];
  layers: CanvasLayer[];
  canvasImages?: CanvasImage[];
  fogEnabled?: boolean;
  fogStrokes?: Array<{
    id: string;
    width: number;
    points: CanvasStrokePoint[];
    authorId: string;
  }>;
};

export type ChatMessage = {
  id: string;
  participantId: string;
  participantDisplayName: string;
  text: string;
  createdAt: string;
};

export type DiceRollLog = {
  id: string;
  participantId: string;
  participantDisplayName: string;
  diceType: string; // e.g. "d6", "d20"
  count: number;
  results: number[];
  total: number;
  createdAt: string;
};

export type RoomRecord = {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  createdBy: RoomParticipant;
  canvas: RoomCanvasState;
  diceLogs: DiceRollLog[];
  canvasHistory: RoomCanvasState[];
  chatMessages: ChatMessage[];
  /** Loaded from DB; never sent to clients */
  hostSecretHash?: string | null;
  participantAcl: ParticipantAcl;
};

export type RoomSession = {
  sessionId: string;
  roomSlug: string;
  participant: RoomParticipant;
  createdAt: string;
  lastSeenAt: string;
  /** WebSocket currently attached */
  connected: boolean;
  disconnectedAt?: string;
  socketId?: string;
  /** Tab visibility / idle hint from client (only while connected) */
  clientUiPresence: 'active' | 'away';
};
