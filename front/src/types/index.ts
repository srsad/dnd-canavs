export type User = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type AuthResponse = {
  accessToken: string;
  user: User;
};

export type Participant = {
  id: string;
  displayName: string;
  kind: 'registered' | 'guest';
  role: 'gm' | 'player';
  userId?: string;
};

export type StrokePoint = {
  x: number;
  y: number;
};

export type Stroke = {
  id: string;
  color: string;
  width: number;
  points: StrokePoint[];
  authorId: string;
};

export type Token = {
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
  strokes: Stroke[];
};

export type RoomCanvas = {
  backgroundColor: string;
  gridEnabled: boolean;
  tokens: Token[];
  layers: CanvasLayer[];
  fogEnabled?: boolean;
  fogStrokes?: Array<{
    id: string;
    width: number;
    points: StrokePoint[];
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
  diceType: string;
  count: number;
  results: number[];
  total: number;
  createdAt: string;
};

export type Room = {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  createdBy: Participant;
  canvas: RoomCanvas;
  diceLogs?: DiceRollLog[];
  canvasHistory?: RoomCanvas[];
  chatMessages?: ChatMessage[];
};

export type JoinRoomResponse = {
  room: Room;
  participant: Participant;
  participants: Participant[];
  sessionId: string;
};

export type RoomSummaryResponse = {
  room: Room;
  participants: Participant[];
};
