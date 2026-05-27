import pino, { type LoggerOptions, type TransportMultiOptions } from "pino";

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info", pretty = shouldUsePrettyLogs()) {
  const options: LoggerOptions = {
    name,
    level,
  };

  if (!pretty) {
    return pino(options);
  }

  const transport: TransportMultiOptions = {
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
          messageFormat: "{name} {msg}",
          singleLine: true,
        },
        level,
      },
    ],
  };

  return pino(options, pino.transport(transport));
}

function shouldUsePrettyLogs() {
  const value = process.env.LOG_PRETTY;
  if (value === undefined) {
    return process.stdout.isTTY;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
