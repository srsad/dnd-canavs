export type RoomParticipant = {
  id: string;
  displayName: string;
  kind: 'registered' | 'guest';
  role: 'gm' | 'player';
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

export type CanvasLayer = {
  id: string;
  name: string;
  visible: boolean;
  strokes: CanvasStroke[];
};

export type RoomCanvasState = {
  backgroundColor: string;
  gridEnabled: boolean;
  tokens: CanvasToken[];
  layers: CanvasLayer[];
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
};

export type RoomSession = {
  sessionId: string;
  roomSlug: string;
  participant: RoomParticipant;
  createdAt: string;
  lastSeenAt: string;
};
