const POKERNOW_URL_REGEX =
  /https?:\/\/(?:www\.)?pokernow\.(?:club|com)\/games\/([A-Za-z0-9_-]+)(?:[/?#][^\s]*)?/gi;
const POKERNOW_PLAYER_URL_REGEX =
  /https?:\/\/(?:www\.)?pokernow\.(?:club|com)\/players\/([A-Za-z0-9_-]+)(?:[/?#][^\s]*)?/i;

export interface PokerNowTableReference {
  tableId: string;
  normalizedUrl: string;
  sourceUrl: string;
}

export interface PokerNowClubGame {
  id: string;
  clubId: string;
  tableId: string;
  name: string | null;
  sourceUrl: string;
  normalizedUrl: string;
  expired: boolean;
  status: string | null;
}

export function extractPokerNowTables(message: string): PokerNowTableReference[] {
  const matches = new Map<string, PokerNowTableReference>();

  for (const match of message.matchAll(POKERNOW_URL_REGEX)) {
    const tableId = match[1];
    const sourceUrl = match[0];
    matches.set(tableId, {
      tableId,
      sourceUrl,
      normalizedUrl: `https://www.pokernow.com/games/${tableId}`,
    });
  }

  return [...matches.values()];
}

export function pokerNowAccountAlias(accountIdOrUrl: string) {
  return `pokernow:${extractPokerNowPlayerId(accountIdOrUrl)}`;
}

export function extractPokerNowPlayerId(accountIdOrUrl: string) {
  const input = accountIdOrUrl.trim();
  const urlMatch = input.match(POKERNOW_PLAYER_URL_REGEX);
  return urlMatch?.[1] ?? input;
}

export function toPokerNowChipCents(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Chip amount must be greater than 0");
  }

  return Math.round(amount * 100);
}

export function parsePokerNowClubGames(payload: unknown, baseUrl = "https://www.pokernow.com"): PokerNowClubGame[] {
  if (!isRecord(payload) || !Array.isArray(payload.games)) {
    return [];
  }

  return payload.games.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.poker_now_game_id !== "string" || typeof entry.club_id !== "string") {
      return [];
    }

    const tableId = entry.poker_now_game_id;
    const normalizedUrl = `${baseUrl.replace(/\/$/, "")}/games/${tableId}`;
    const game = isRecord(entry.game) ? entry.game : {};
    return [
      {
        id: typeof entry.id === "string" ? entry.id : tableId,
        clubId: entry.club_id,
        tableId,
        name: typeof entry.custom_table_name === "string" ? entry.custom_table_name : null,
        sourceUrl: normalizedUrl,
        normalizedUrl,
        expired: entry.expired === true,
        status: typeof game.status === "string" ? game.status : null,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
