const POKERNOW_URL_REGEX =
  /https?:\/\/(?:www\.)?pokernow\.(?:club|com)\/games\/([A-Za-z0-9_-]+)(?:[/?#][^\s]*)?/gi;

export interface PokerNowTableReference {
  tableId: string;
  normalizedUrl: string;
  sourceUrl: string;
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
