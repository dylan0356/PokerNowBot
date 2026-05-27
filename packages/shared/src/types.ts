export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type ActionType = "fold" | "call" | "raise" | "check" | "bet" | "allin" | "post_blind";
export type StatsScope = "OVERALL" | "BY_GAME_TYPE" | "BY_HANDEDNESS" | "BY_GAME_TYPE_HANDEDNESS";
export type HandednessBucket = "HEADS_UP" | "MULTIWAY" | "THREE_HANDED" | "FOUR_HANDED" | "FIVE_HANDED" | "SIX_PLUS";

export interface TrackerEventEnvelope {
  tableId: string;
  eventType: string;
  sequence: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface PokerNowLogEntry {
  msg: string;
  createdAt: string;
}

export interface ReconstructedAction {
  sequence: number;
  street: Street;
  playerAlias: string;
  actionType: ActionType;
  amount?: number;
  occurredAt: string;
}

export interface ReconstructedHandPlayer {
  playerAlias: string;
  seat?: number;
  position?: string;
  stackStart?: number;
  stackEnd?: number;
  vpip: boolean;
  pfr: boolean;
  profit: number;
}

export interface ReconstructedHand {
  handId: string;
  tableId: string;
  handNumber?: number;
  gameType?: string;
  handedness?: number;
  startedAt: string;
  finishedAt: string;
  buttonSeat?: number;
  smallBlindAlias?: string;
  bigBlindAlias?: string;
  smallBlindAmount?: number;
  bigBlindAmount?: number;
  anteAmount?: number;
  boardCards: string[];
  potSize: number;
  winners: string[];
  players: ReconstructedHandPlayer[];
  actions: ReconstructedAction[];
  rawEvents: TrackerEventEnvelope[];
  sourceEntries?: PokerNowLogEntry[];
}

export interface PlayerStats {
  handsPlayed: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  fourBet: number;
  cbet: number;
  foldToCbet: number;
  profitTotal: number;
  profitTotalBb: number;
  bbPerHundred: number;
  biggestPotWon: number;
  biggestPotWonBb: number;
  biggestPunt: number;
  biggestPuntBb: number;
}

export interface StatsDimension {
  scope: StatsScope;
  gameType?: string;
  handednessBucket?: HandednessBucket;
  dimensionKey: string;
}
