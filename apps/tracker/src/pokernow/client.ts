import io, { type SocketLike } from "socket.io-client";

export interface PokerNowRealtimeClientOptions {
  socketUrl: string;
  tableId: string;
  layout: string;
  cookieHeader?: string;
  queryPlayerToken?: string;
  onConnecting: (details: {
    socketUrl: string;
    tableId: string;
    layout: string;
    hasCookieHeader: boolean;
    hasQueryPlayerToken: boolean;
    connectionAttempt: number;
  }) => Promise<void>;
  onConnected: (details: {
    socketUrl: string;
    tableId: string;
    connectionAttempt: number;
  }) => Promise<void>;
  onRegistered: (payload: Record<string, unknown>, connectionAttempt: number) => Promise<void>;
  onSocketEvent: (eventName: string, payload: Record<string, unknown>, connectionAttempt: number) => Promise<void>;
  onReconnectAttempt: (connectionAttempt: number) => Promise<void>;
  onDisconnect: (reason: string, connectionAttempt: number) => Promise<void>;
  onFailed: (payload: Record<string, unknown>, connectionAttempt: number) => Promise<void>;
  onConnectError: (error: Error, connectionAttempt: number) => Promise<void>;
}

export class PokerNowRealtimeClient {
  private socket?: SocketLike;
  private connectionAttempt = 1;
  private firstConnection = true;
  private readonly closePromise: Promise<void>;
  private closeResolver!: () => void;
  private closeRejecter!: (error: Error) => void;

  constructor(private readonly options: PokerNowRealtimeClientOptions) {
    this.closePromise = new Promise<void>((resolve, reject) => {
      this.closeResolver = resolve;
      this.closeRejecter = reject;
    });
  }

  async connectAndRun() {
    await this.options.onConnecting({
      socketUrl: this.options.socketUrl,
      tableId: this.options.tableId,
      layout: this.options.layout,
      hasCookieHeader: Boolean(this.options.cookieHeader),
      hasQueryPlayerToken: Boolean(this.options.queryPlayerToken),
      connectionAttempt: this.connectionAttempt,
    });

    this.socket = io(this.options.socketUrl, {
      transports: ["websocket"],
      forceNew: true,
      forceNode: true,
      query: {
        gameID: this.options.tableId,
        firstConnection: this.firstConnection ? "true" : "false",
        layout: this.options.layout,
        ...(this.options.queryPlayerToken ? { ut: this.options.queryPlayerToken } : {}),
      },
      extraHeaders: {
        Origin: "https://www.pokernow.com",
        ...(this.options.cookieHeader ? { Cookie: this.options.cookieHeader } : {}),
      },
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on("connect", () => {
      this.firstConnection = false;
      void this.options.onConnected({
        socketUrl: this.options.socketUrl,
        tableId: this.options.tableId,
        connectionAttempt: this.connectionAttempt,
      });
    });

    this.socket.on("registered", async (payload: unknown) => {
      await this.options.onRegistered(asRecord(payload), this.connectionAttempt);
      this.requestResync();
    });

    for (const eventName of ["rup", "gC", "IGPU", "DSP", "UGD"] as const) {
      this.socket.on(eventName, async (payload: unknown) => {
        await this.options.onSocketEvent(eventName, asRecord(payload), this.connectionAttempt);
      });
    }

    this.socket.on("reconnect_attempt", async () => {
      this.connectionAttempt += 1;
      if (this.socket?.io.opts.query && typeof this.socket.io.opts.query === "object") {
        delete (this.socket.io.opts.query as Record<string, unknown>).firstConnection;
      }
      await this.options.onReconnectAttempt(this.connectionAttempt);
    });

    this.socket.on("failed", async (payload: unknown) => {
      await this.options.onFailed(asRecord(payload), this.connectionAttempt);
    });

    this.socket.on("disconnect", async (reason: unknown) => {
      await this.options.onDisconnect(String(reason), this.connectionAttempt);
      if (reason === "io server disconnect") {
        this.closeResolver();
      }
    });

    this.socket.on("connect_error", (error: unknown) => {
      void this.options.onConnectError(error instanceof Error ? error : new Error(String(error)), this.connectionAttempt);
      this.closeRejecter(error instanceof Error ? error : new Error(String(error)));
    });

    return this.closePromise;
  }

  requestResync() {
    this.socket?.emit("action", { type: "RUP" });
  }

  disconnect() {
    this.socket?.disconnect();
    this.closeResolver();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
