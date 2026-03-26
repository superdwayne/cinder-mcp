import { randomUUID } from "node:crypto";
import { Socket } from "node:net";

export type OscArgType = "f" | "i" | "s" | "b";

export interface OscArg {
  type: OscArgType;
  value: number | string | Buffer;
}

export interface OscMessage {
  address: string;
  args: OscArg[];
}

interface PendingCommand {
  resolve: (value: OscMessage) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OscClientOptions {
  host?: string;
  port?: number;
  timeout?: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

const DEFAULT_OPTIONS: Required<OscClientOptions> = {
  host: "127.0.0.1",
  port: 9000,
  timeout: 5000,
  reconnect: true,
  reconnectInterval: 2000,
  maxReconnectAttempts: 10,
};

/**
 * OSC client that communicates with the Cinder bridge over TCP.
 * Supports command-ack matching via unique command IDs,
 * auto-reconnect, and configurable timeouts.
 */
export class OscClient {
  private socket: Socket | null = null;
  private options: Required<OscClientOptions>;
  private pending: Map<string, PendingCommand> = new Map();
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(options: OscClientOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Connect to the Cinder OSC bridge via TCP.
   */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.connected && this.socket) {
        resolve();
        return;
      }

      this.socket = new Socket();

      this.socket.on("connect", () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.socket.on("data", (data: Buffer) => {
        this.handleData(data);
      });

      this.socket.on("error", (err: Error) => {
        if (!this.connected) {
          reject(err);
          return;
        }
        this.handleDisconnect();
      });

      this.socket.on("close", () => {
        this.handleDisconnect();
      });

      this.socket.connect(this.options.port, this.options.host);
    });
  }

  /**
   * Disconnect from the bridge.
   */
  disconnect(): void {
    this.connected = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending commands
    for (const [id, cmd] of this.pending) {
      clearTimeout(cmd.timer);
      cmd.reject(new Error("Client disconnected"));
      this.pending.delete(id);
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * Send an OSC message and wait for an ack response.
   * The command ID is generated and appended as the first argument.
   */
  async send(address: string, args: OscArg[] = []): Promise<OscMessage> {
    if (!this.connected || !this.socket) {
      throw new Error("Not connected to OSC bridge");
    }

    const commandId = this.generateCommandId();

    // Prepend command ID as first arg
    const fullArgs: OscArg[] = [
      { type: "s", value: commandId },
      ...args,
    ];

    const message: OscMessage = { address, args: fullArgs };
    const packet = this.encodeMessage(message);

    return new Promise<OscMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(
          new Error(
            `Timeout waiting for ack on ${address} (id: ${commandId})`,
          ),
        );
      }, this.options.timeout);

      this.pending.set(commandId, { resolve, reject, timer });

      this.socket!.write(packet, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(commandId);
          reject(err);
        }
      });
    });
  }

  /**
   * Scan a port range for active Cinder bridges.
   * Returns a list of ports that accepted a TCP connection.
   */
  async scan(startPort: number, endPort: number): Promise<number[]> {
    const activePorts: number[] = [];
    const probes: Promise<void>[] = [];

    for (let port = startPort; port <= endPort; port++) {
      probes.push(
        new Promise<void>((resolve) => {
          const sock = new Socket();
          sock.setTimeout(500);

          sock.on("connect", () => {
            activePorts.push(port);
            sock.destroy();
            resolve();
          });

          sock.on("error", () => {
            sock.destroy();
            resolve();
          });

          sock.on("timeout", () => {
            sock.destroy();
            resolve();
          });

          sock.connect(port, this.options.host);
        }),
      );
    }

    await Promise.all(probes);
    return activePorts.sort((a, b) => a - b);
  }

  /**
   * Whether the client is currently connected.
   */
  get isConnected(): boolean {
    return this.connected;
  }

  // --- Private Methods ---

  private generateCommandId(): string {
    return randomUUID();
  }

  /**
   * Handle incoming data from the TCP socket.
   * Buffers partial messages and extracts complete OSC packets.
   */
  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    // OSC over TCP uses a 4-byte length prefix (SLIP or size-prefixed framing)
    while (this.buffer.length >= 4) {
      const packetLen = this.buffer.readUInt32BE(0);

      if (this.buffer.length < 4 + packetLen) {
        break; // Wait for more data
      }

      const packetData = this.buffer.subarray(4, 4 + packetLen);
      this.buffer = this.buffer.subarray(4 + packetLen);

      try {
        const message = this.decodeMessage(packetData);
        this.handleMessage(message);
      } catch {
        // Skip malformed packets
      }
    }
  }

  /**
   * Match an incoming message to a pending command via command ID.
   */
  private handleMessage(message: OscMessage): void {
    // The ack should have the command ID as the first argument
    if (message.args.length > 0 && message.args[0].type === "s") {
      const commandId = message.args[0].value as string;
      const pending = this.pending.get(commandId);

      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(commandId);
        pending.resolve(message);
        return;
      }
    }
  }

  /**
   * Handle disconnection and optional auto-reconnect.
   */
  private handleDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;

    if (
      wasConnected &&
      this.options.reconnect &&
      this.reconnectAttempts < this.options.maxReconnectAttempts
    ) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        this.connect().catch(() => {
          // Reconnect failed, will retry via handleDisconnect
        });
      }, this.options.reconnectInterval);
    }
  }

  /**
   * Encode an OSC message into a size-prefixed TCP packet.
   * Simplified encoding: address + type tag string + args.
   */
  private encodeMessage(message: OscMessage): Buffer {
    const addressBuf = this.encodeString(message.address);
    const typeTag =
      "," + message.args.map((a) => a.type).join("");
    const typeTagBuf = this.encodeString(typeTag);

    const argBuffers: Buffer[] = message.args.map((arg) => {
      switch (arg.type) {
        case "f": {
          const buf = Buffer.alloc(4);
          buf.writeFloatBE(arg.value as number, 0);
          return buf;
        }
        case "i": {
          const buf = Buffer.alloc(4);
          buf.writeInt32BE(arg.value as number, 0);
          return buf;
        }
        case "s":
          return this.encodeString(arg.value as string);
        case "b": {
          const blobData = arg.value as Buffer;
          const sizeBuf = Buffer.alloc(4);
          sizeBuf.writeInt32BE(blobData.length, 0);
          const padLen = (4 - (blobData.length % 4)) % 4;
          return Buffer.concat([sizeBuf, blobData, Buffer.alloc(padLen)]);
        }
      }
    });

    const oscPayload = Buffer.concat([addressBuf, typeTagBuf, ...argBuffers]);

    // Size-prefixed framing
    const frame = Buffer.alloc(4 + oscPayload.length);
    frame.writeUInt32BE(oscPayload.length, 0);
    oscPayload.copy(frame, 4);

    return frame;
  }

  /**
   * Decode a raw OSC packet buffer into an OscMessage.
   */
  private decodeMessage(data: Buffer): OscMessage {
    let offset = 0;

    const { value: address, newOffset: o1 } = this.decodeString(data, offset);
    offset = o1;

    const { value: typeTagRaw, newOffset: o2 } = this.decodeString(
      data,
      offset,
    );
    offset = o2;

    // Strip leading comma
    const typeTag = typeTagRaw.startsWith(",")
      ? typeTagRaw.slice(1)
      : typeTagRaw;

    const args: OscArg[] = [];

    for (const t of typeTag) {
      switch (t) {
        case "f": {
          const val = data.readFloatBE(offset);
          offset += 4;
          args.push({ type: "f", value: val });
          break;
        }
        case "i": {
          const val = data.readInt32BE(offset);
          offset += 4;
          args.push({ type: "i", value: val });
          break;
        }
        case "s": {
          const { value, newOffset } = this.decodeString(data, offset);
          offset = newOffset;
          args.push({ type: "s", value });
          break;
        }
        case "b": {
          const blobLen = data.readInt32BE(offset);
          offset += 4;
          const blobData = data.subarray(offset, offset + blobLen);
          offset += blobLen;
          const padLen = (4 - (blobLen % 4)) % 4;
          offset += padLen;
          args.push({ type: "b", value: Buffer.from(blobData) });
          break;
        }
      }
    }

    return { address, args };
  }

  /**
   * Encode a string with null terminator and 4-byte alignment padding.
   */
  private encodeString(str: string): Buffer {
    const strBuf = Buffer.from(str, "utf-8");
    const totalLen = strBuf.length + 1; // +1 for null terminator
    const padded = totalLen + ((4 - (totalLen % 4)) % 4);
    const buf = Buffer.alloc(padded);
    strBuf.copy(buf, 0);
    return buf;
  }

  /**
   * Decode a null-terminated, 4-byte-aligned string from a buffer.
   */
  private decodeString(
    data: Buffer,
    offset: number,
  ): { value: string; newOffset: number } {
    let end = offset;
    while (end < data.length && data[end] !== 0) {
      end++;
    }
    const value = data.subarray(offset, end).toString("utf-8");
    const totalLen = end - offset + 1;
    const padded = totalLen + ((4 - (totalLen % 4)) % 4);
    return { value, newOffset: offset + padded };
  }
}
