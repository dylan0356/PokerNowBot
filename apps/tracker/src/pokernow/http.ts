import type { PokerNowLogEntry } from "@pokernow/shared";

export async function bootstrapPokerNowCookieHeader(
  baseUrl: string,
  tableId: string,
  manualCookieHeader?: string,
): Promise<string | undefined> {
  const response = await fetch(`${baseUrl}/games/${tableId}`, {
    redirect: "follow",
    headers: manualCookieHeader ? { Cookie: manualCookieHeader } : undefined,
  });
  const setCookieHeader = extractSetCookieHeader(response);

  if (!manualCookieHeader) {
    return setCookieHeader || undefined;
  }

  if (!setCookieHeader) {
    return manualCookieHeader;
  }

  return mergeCookieHeaders(manualCookieHeader, setCookieHeader);
}

export async function fetchPokerNowLogEntries(
  baseUrl: string,
  tableId: string,
  handNumber?: number,
  cookieHeader?: string,
): Promise<PokerNowLogEntry[]> {
  const url = new URL(`${baseUrl}/api/games/${tableId}/log_v3`);
  if (handNumber !== undefined) {
    url.searchParams.set("hand_number", String(handNumber));
  }

  const response = await fetch(url, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PokerNow log_v3 for ${tableId}${handNumber !== undefined ? ` hand ${handNumber}` : ""}: ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.flatMap((entry) => {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { msg?: unknown }).msg === "string" &&
      typeof (entry as { createdAt?: unknown }).createdAt === "string"
    ) {
      return [
        {
          msg: (entry as { msg: string }).msg,
          createdAt: (entry as { createdAt: string }).createdAt,
        },
      ];
    }

    return [];
  });
}

function extractSetCookieHeader(response: Response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const cookieHeaders = getSetCookie ? getSetCookie() : [];
  return cookieHeaders.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

function mergeCookieHeaders(left: string, right: string) {
  const cookies = new Map<string, string>();

  for (const header of [left, right]) {
    for (const segment of header.split(";")) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }

      const [name, ...value] = trimmed.split("=");
      cookies.set(name, value.join("="));
    }
  }

  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}
