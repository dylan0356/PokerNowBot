import { parsePokerNowClubGames, type PokerNowClubGame } from "./pokernow.js";

export interface PokerNowInternalClientOptions {
  baseUrl: string;
  cookieHeader?: string;
}

export interface PokerNowChipMovementResult {
  movementId: string | null;
  playerId: string | null;
  userId: string | null;
  chipsBalance: string | null;
  creditLimit: string | null;
}

export class PokerNowInternalClient {
  private readonly baseUrl: string;

  constructor(private readonly options: PokerNowInternalClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  async addClubChips(clubId: string, pokerNowUserId: string, amountCents: number) {
    return this.moveClubChips("add", clubId, pokerNowUserId, amountCents);
  }

  async removeClubChips(clubId: string, pokerNowUserId: string, amountCents: number) {
    return this.moveClubChips("remove", clubId, pokerNowUserId, amountCents);
  }

  async refreshClubGames(clubId: string, playerId: string): Promise<PokerNowClubGame[]> {
    this.requireCookieHeader();
    const url = new URL(`${this.baseUrl}/clubs/mtt/club/refresh/games`);
    url.searchParams.set("clubId", clubId);
    url.searchParams.set("playerId", playerId);

    const payload = await this.requestJson(url, {
      method: "GET",
      headers: this.headers(`${this.baseUrl}/clubs/${clubId}`),
    });

    if (!isRecord(payload) || payload.success !== true) {
      throw new Error("PokerNow club refresh did not return success");
    }

    return parsePokerNowClubGames(payload, this.baseUrl).filter((game) => !game.expired);
  }

  private async moveClubChips(action: "add" | "remove", clubId: string, pokerNowUserId: string, amountCents: number) {
    this.requireCookieHeader();
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error("Chip amount must be a positive cent integer");
    }

    const url = `${this.baseUrl}/clubs/chips/${action}/${clubId}/${pokerNowUserId}`;
    const payload = await this.requestJson(url, {
      method: "POST",
      headers: {
        ...this.headers(`${this.baseUrl}/clubs/${clubId}`),
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: amountCents }),
    });

    if (!isRecord(payload) || payload.success !== true || !isRecord(payload.result)) {
      throw new Error(`PokerNow chip ${action} did not return success`);
    }

    const updatedPlayer = isRecord(payload.result.updatedPlayer) ? payload.result.updatedPlayer : {};
    const movement = isRecord(payload.result.movement) ? payload.result.movement : {};
    return {
      movementId: typeof movement.id === "string" ? movement.id : null,
      playerId: typeof updatedPlayer.id === "string" ? updatedPlayer.id : null,
      userId: typeof updatedPlayer.user_id === "string" ? updatedPlayer.user_id : null,
      chipsBalance: typeof updatedPlayer.chips_balance === "string" ? updatedPlayer.chips_balance : null,
      creditLimit: typeof updatedPlayer.credit_limit === "string" ? updatedPlayer.credit_limit : null,
    } satisfies PokerNowChipMovementResult;
  }

  private headers(referer: string) {
    return {
      accept: "application/json, text/javascript, */*; q=0.01",
      cookie: this.requireCookieHeader(),
      referer,
      "x-requested-with": "XMLHttpRequest",
    };
  }

  private requireCookieHeader() {
    if (!this.options.cookieHeader) {
      throw new Error("POKERNOW_COOKIE_HEADER is required for this PokerNow club operation");
    }

    return this.options.cookieHeader;
  }

  private async requestJson(input: string | URL, init: RequestInit) {
    const response = await fetch(input, init);
    if (!response.ok) {
      throw new Error(`PokerNow request failed with HTTP ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
