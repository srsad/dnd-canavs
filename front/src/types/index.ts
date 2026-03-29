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

export type ParticipantPresence = 'online' | 'offline' | 'away';

export type ParticipantPermissions = {
  editCanvas: boolean;
  moveAnyToken: boolean;
  manageParticipants: boolean;
};

export type Participant = {
  id: string;
  displayName: string;
  kind: 'registered' | 'guest';
  role: 'gm' | 'player';
  userId?: string;
  /** Partial overrides merged with role defaults on the server */
  permissions?: Partial<ParticipantPermissions>;
  /** Omitted on `room.createdBy` until merged from presence payloads */
  presence?: ParticipantPresence;
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
  /** Участник, который может двигать фишку (мастер может двигать любую). */
  controlledByParticipantId?: string | null;
};

export type CanvasLayer = {
  id: string;
  name: string;
  visible: boolean;
  strokes: Stroke[];
};

export type CanvasImage = {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type RoomCanvas = {
  backgroundColor: string;
  gridEnabled: boolean;
  tokens: Token[];
  layers: CanvasLayer[];
  canvasImages?: CanvasImage[];
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
  /** UUID fragment for guest identity persistence */
  guestKey?: string;
};

/** POST /rooms */
export type CreateRoomApiResponse = Omit<JoinRoomResponse, 'participants'> & {
  hostSecret?: string;
};

export type RoomSummaryResponse = {
  room: Room;
  participants: Participant[];
};

/** POST /rooms/:slug/export */
export type RoomExportSnapshot = {
  version: 1;
  exportedAt: string;
  title: string;
  canvas: RoomCanvas;
  diceLogs: DiceRollLog[];
  canvasHistory: RoomCanvas[];
  chatMessages: ChatMessage[];
  participantAcl: Record<
    string,
    { permissions?: Partial<ParticipantPermissions> }
  >;
};

export type AuditEventRow = {
  id: string;
  createdAt: string;
  actorId: string | null;
  type: string;
  payload: unknown;
};
