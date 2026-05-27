declare module "socket.io-client" {
  export interface SocketLike {
    on(event: string, listener: (...args: unknown[]) => void): SocketLike;
    emit(event: string, payload?: unknown): SocketLike;
    disconnect(): void;
    io: {
      opts: {
        query?: Record<string, unknown>;
      };
    };
  }

  export interface SocketOptions {
    transports?: string[];
    forceNew?: boolean;
    forceNode?: boolean;
    query?: Record<string, string>;
    extraHeaders?: Record<string, string>;
    withCredentials?: boolean;
    reconnection?: boolean;
    reconnectionAttempts?: number;
    reconnectionDelay?: number;
  }

  export default function io(url: string, opts?: SocketOptions): SocketLike;
}
