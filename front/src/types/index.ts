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

export type RoomCanvas = {
  backgroundColor: string;
  gridEnabled: boolean;
  strokes: Stroke[];
  tokens: Token[];
};

export type Room = {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  createdBy: Participant;
  canvas: RoomCanvas;
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
