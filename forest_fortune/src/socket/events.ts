export const SOCKET_EVENTS = {
  ACTION: 'action',
  MESSAGE: 'message',
};

export const EVENT_TYPES = {
  // Incoming events from client
  THROW_ARROW: 'THROW_ARROW',
  gameService: 'gameService',
  DIFFICULTY_CHANGE: 'DIFFICULTY_CHANGE',
  join_game : 'join_game',
  // Outgoing events from server
  SPIN_RESULT: 'SPIN_RESULT',
  joined:"joined",
  info: 'info',
  Error: 'Error',
  GAME_CONFIG: 'GAME_CONFIG',
  useranotherwindow:'useranotherwindow'
} as const;

export type IncomingEventType =
  | typeof EVENT_TYPES.gameService
  | typeof EVENT_TYPES.THROW_ARROW
  | typeof EVENT_TYPES.DIFFICULTY_CHANGE;

export type OutgoingEventType =
  | typeof EVENT_TYPES.SPIN_RESULT
  | typeof EVENT_TYPES.info
  | typeof EVENT_TYPES.Error
  | typeof EVENT_TYPES.GAME_CONFIG
  | typeof EVENT_TYPES.DIFFICULTY_CHANGE
  | typeof EVENT_TYPES.useranotherwindow;