export type RoomParticipant = {
  id: string;
  displayName: string;
  kind: 'registered' | 'guest';
  userId?: string;
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
};

export type RoomCanvasState = {
  backgroundColor: string;
  gridEnabled: boolean;
  strokes: CanvasStroke[];
  tokens: CanvasToken[];
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
};

export type RoomSession = {
  sessionId: string;
  roomSlug: string;
  participant: RoomParticipant;
  createdAt: string;
  lastSeenAt: string;
};
