export const SOCKET_EVENTS = {
  ACTION: 'action',
  MESSAGE: 'message',
};

export const EVENT_TYPES = {
  // Incoming events from client
  Place_Bet: 'PB',
  gameService: 'gameService',
  // Outgoing events from server
  betPlaced: 'betPlaced',
  win: 'win',
  lose: 'lose',
  info: 'info',
  Error: 'Error',
  GAME_CONFIG: 'GAME_CONFIG',
  anotherwindow: 'anotherwindow',
  ROUND_HISTORY: 'ROUND_HISTORY',
  GAME_STATE: "GAME_STATE",
  CASHOUT: "CASHOUT",
  GLASS_CASHOUT: "GLASS_CASHOUT"
} as const;

export type IncomingEventType =
  | typeof EVENT_TYPES.gameService
  | typeof EVENT_TYPES.Place_Bet

export type OutgoingEventType =
  | typeof EVENT_TYPES.info
  | typeof EVENT_TYPES.Error
  | typeof EVENT_TYPES.GAME_CONFIG
  | typeof EVENT_TYPES.anotherwindow
  | typeof EVENT_TYPES.win
  | typeof EVENT_TYPES.lose
  | typeof EVENT_TYPES.betPlaced
  | typeof EVENT_TYPES.ROUND_HISTORY
  | typeof EVENT_TYPES.GAME_STATE
  | typeof EVENT_TYPES.CASHOUT
  | typeof EVENT_TYPES.GLASS_CASHOUT;