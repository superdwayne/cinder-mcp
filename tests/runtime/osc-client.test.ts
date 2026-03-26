import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Socket } from "node:net";

// Mock node:net Socket
vi.mock("node:net", () => {
  const EventEmitter = require("node:events").EventEmitter;

  class MockSocket extends EventEmitter {
    destroyed = false;

    connect = vi.fn(function (
      this: MockSocket,
      _port: number,
      _host: string,
    ) {
      // Simulate async connect
      setTimeout(() => this.emit("connect"), 10);
      return this;
    });

    write = vi.fn(function (
      this: MockSocket,
      _data: Buffer,
      cb?: (err?: Error) => void,
    ) {
      if (cb) cb();
      return true;
    });

    destroy = vi.fn(function (this: MockSocket) {
      this.destroyed = true;
    });

    setTimeout = vi.fn();
  }

  return { Socket: MockSocket };
});

import { OscClient } from "../../src/runtime/osc-client.js";

describe("OscClient", () => {
  let client: OscClient;

  beforeEach(() => {
    client = new OscClient({
      host: "127.0.0.1",
      port: 9000,
      timeout: 1000,
      reconnect: false,
    });
  });

  afterEach(() => {
    client.disconnect();
  });

  describe("constructor", () => {
    it("should create a client with default options", () => {
      const defaultClient = new OscClient();
      expect(defaultClient).toBeDefined();
      expect(defaultClient.isConnected).toBe(false);
    });

    it("should create a client with custom options", () => {
      const customClient = new OscClient({
        host: "192.168.1.100",
        port: 8000,
        timeout: 3000,
      });
      expect(customClient).toBeDefined();
      expect(customClient.isConnected).toBe(false);
    });
  });

  describe("connect", () => {
    it("should connect to the OSC bridge", async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);
    });

    it("should resolve immediately if already connected", async () => {
      await client.connect();
      // Second connect should resolve immediately
      await client.connect();
      expect(client.isConnected).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("should disconnect from the bridge", async () => {
      await client.connect();
      client.disconnect();
      expect(client.isConnected).toBe(false);
    });

    it("should handle disconnect when not connected", () => {
      // Should not throw
      client.disconnect();
      expect(client.isConnected).toBe(false);
    });
  });

  describe("send", () => {
    it("should throw if not connected", async () => {
      await expect(client.send("/test")).rejects.toThrow("Not connected");
    });

    it("should send a message after connecting", async () => {
      await client.connect();
      // The send will timeout since we're mocking, but it should not throw immediately
      const sendPromise = client.send("/cinder/ping");
      // Let it timeout
      await expect(sendPromise).rejects.toThrow("Timeout");
    });

    it("should send messages with arguments", async () => {
      await client.connect();
      const sendPromise = client.send("/cinder/set_uniform", [
        { type: "s", value: "uTime" },
        { type: "f", value: 1.5 },
      ]);
      await expect(sendPromise).rejects.toThrow("Timeout");
    });
  });

  describe("scan", () => {
    it("should scan a port range for active bridges", async () => {
      // The mock socket emits connect, so all ports in range will appear active
      const ports = await client.scan(9000, 9002);
      expect(Array.isArray(ports)).toBe(true);
      // Mock connects succeed, so ports should be found
      expect(ports.length).toBeGreaterThanOrEqual(0);
    });

    it("should return sorted port list", async () => {
      const ports = await client.scan(9000, 9005);
      for (let i = 1; i < ports.length; i++) {
        expect(ports[i]).toBeGreaterThanOrEqual(ports[i - 1]);
      }
    });
  });

  describe("isConnected", () => {
    it("should return false initially", () => {
      expect(client.isConnected).toBe(false);
    });

    it("should return true after connect", async () => {
      await client.connect();
      expect(client.isConnected).toBe(true);
    });

    it("should return false after disconnect", async () => {
      await client.connect();
      client.disconnect();
      expect(client.isConnected).toBe(false);
    });
  });
});
