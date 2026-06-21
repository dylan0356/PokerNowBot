export const queueNames = {
  trackTable: "track-table",
  reconnectTable: "reconnect-table",
  finalizeHand: "finalize-hand",
  refreshStats: "refresh-stats",
  monthlySnapshot: "monthly-snapshot",
  rebuildSessionFromRaw: "rebuild-session-from-raw",
  reconcilePokerNowHand: "reconcile-pokernow-hand",
  syncPokerNowClubs: "sync-pokernow-clubs",
} as const;

export interface TrackTableJob {
  guildId: string;
  trackedTableId: string;
  tableId: string;
  sourceUrl: string;
}

export interface FinalizeHandJob {
  trackingSessionId: string;
  handId: string;
}

export interface RefreshStatsJob {
  guildId: string;
  discordUserId?: string;
}

export interface MonthlySnapshotJob {
  guildId: string;
  year: number;
  month: number;
}

export interface ReconcilePokerNowHandJob {
  guildId: string;
  trackingSessionId: string;
  trackedTableId: string;
  tableId: string;
  handNumber?: number;
}

export interface SyncPokerNowClubsJob {
  guildId?: string;
  clubId?: string;
}
