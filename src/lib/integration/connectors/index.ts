import { HttpConnector } from "./http";
import { MockConnector } from "./mock";
import type { ConnectionRow, UniklifeConnector } from "./types";

export * from "./types";
export { MockConnector, mockConnectorTestHooks } from "./mock";
export { HttpConnector, assertSafeDestination, integrationDisabled } from "./http";

const mock = new MockConnector();
const http = new HttpConnector();

/**
 * Mock is the default. A 'live' connection gets the HTTP connector, which itself
 * refuses to send unless UNIKLIFE_LIVE_ENABLED=true and the connection is live_verified.
 */
export function connectorFor(connection: ConnectionRow): UniklifeConnector {
  return connection.mode === "live" ? http : mock;
}
