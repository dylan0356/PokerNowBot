export interface BullConnectionConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
}

export function toBullConnection(redisUrl: string): BullConnectionConfig {
  const parsed = new URL(redisUrl);

  return {
    host: parsed.hostname,
    port: Number(parsed.port || "6379"),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "") || "0") : 0,
    maxRetriesPerRequest: null,
  };
}
