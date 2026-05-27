export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  discordToken: string;
  discordClientId: string;
  discordGuildIds: string[];
  pokernowBaseUrl: string;
  pokernowSocketUrl: string;
  pokernowLayout: string;
  pokernowCookieHeader?: string;
  pokernowQueryPlayerToken?: string;
  pokernowHeartbeatTimeoutMs: number;
  sentryDsn?: string;
  logLevel: string;
  logPretty: boolean;
  port: number;
}

export function readConfig(): AppConfig {
  return {
    databaseUrl: mustEnv("DATABASE_URL"),
    redisUrl: mustEnv("REDIS_URL"),
    discordToken: process.env.DISCORD_TOKEN ?? "",
    discordClientId: process.env.DISCORD_CLIENT_ID ?? "",
    discordGuildIds: (process.env.DISCORD_GUILD_IDS ?? process.env.DISCORD_GUILD_ID ?? "")
      .split(",")
      .map((guildId) => guildId.trim())
      .filter(Boolean),
    pokernowBaseUrl: process.env.POKERNOW_BASE_URL ?? "https://www.pokernow.com",
    pokernowSocketUrl: process.env.POKERNOW_SOCKET_URL ?? "https://www.pokernow.com",
    pokernowLayout: process.env.POKERNOW_LAYOUT ?? "d",
    pokernowCookieHeader: process.env.POKERNOW_COOKIE_HEADER || undefined,
    pokernowQueryPlayerToken: process.env.POKERNOW_QUERY_PLAYER_TOKEN || undefined,
    pokernowHeartbeatTimeoutMs: Number(process.env.POKERNOW_HEARTBEAT_TIMEOUT_MS ?? "30000"),
    sentryDsn: process.env.SENTRY_DSN,
    logLevel: process.env.LOG_LEVEL ?? "info",
    logPretty: parseBoolean(process.env.LOG_PRETTY, process.stdout.isTTY),
    port: Number(process.env.PORT ?? "3000"),
  };
}

function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
