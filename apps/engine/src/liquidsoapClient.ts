// Tiny TCP client for LiquidSoap's telnet server — this is what actually
// delivers a finished clip into the live stream.
//
// Protocol: LiquidSoap sends no greeting banner. You write one command per
// line and it replies with zero or more output lines followed by a bare
// "END" line. `request.queue(id="inject")` defaults to `interactive=true`, so
// it registers the telnet command `inject.push <uri>`, which replies with the
// new request's id.

import { createConnection } from "node:net";
import { config } from "./config.ts";

const END_LINE = /^END$/m;

export class LiquidsoapUnavailableError extends Error {
  constructor(cause: string) {
    super(
      `Could not reach LiquidSoap's telnet server at ` +
        `${config.liquidsoapTelnetHost}:${config.liquidsoapTelnetPort} (${cause}). ` +
        `Is liquidsoap running (nix develop -c liquidsoap liquidsoap/radio.liq)?`,
    );
    this.name = "LiquidsoapUnavailableError";
  }
}

/**
 * Sends one command and resolves with the response text (the "END" terminator
 * stripped). Opens a fresh short-lived connection per command — clip delivery
 * is infrequent, so a persistent socket would be more state to get wrong than
 * it saves.
 */
export function sendCommand(
  command: string,
  timeoutMs = 5_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: config.liquidsoapTelnetHost,
      port: config.liquidsoapTelnetPort,
    });

    let buffer = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.setEncoding("utf8");

    socket.on("connect", () => socket.write(`${command}\n`));

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (END_LINE.test(buffer)) {
        const body = buffer.split(END_LINE)[0] ?? "";
        finish(() => resolve(body.trim()));
      }
    });

    socket.on("timeout", () =>
      finish(() => reject(new LiquidsoapUnavailableError("timed out"))),
    );
    socket.on("error", (err: Error) =>
      finish(() => reject(new LiquidsoapUnavailableError(err.message))),
    );
    socket.on("close", () =>
      // Closed before an END terminator arrived.
      finish(() =>
        reject(
          new LiquidsoapUnavailableError(
            `connection closed after ${buffer.length} byte(s) with no END terminator`,
          ),
        ),
      ),
    );
  });
}

/**
 * Pushes an absolute audio path into the `inject` request queue, so LiquidSoap
 * plays it at the next track boundary (the fallback is `track_sensitive=false`,
 * so this never cuts into an in-progress crossfade).
 *
 * Returns LiquidSoap's assigned request id. Throws if the queue rejects the
 * push or LiquidSoap isn't reachable.
 */
export async function pushToInjectQueue(
  absoluteAudioPath: string,
): Promise<string> {
  const response = await sendCommand(`inject.push ${absoluteAudioPath}`);

  // A successful push replies with a bare numeric request id. Anything else
  // (e.g. "Unknown command") means the push did not land, and silently
  // treating that as success would mark the clip 'used' having never aired.
  if (!/^\d+$/.test(response)) {
    throw new Error(
      `inject.push was not accepted by LiquidSoap. Response: ${
        response === "" ? "<empty>" : response
      }`,
    );
  }
  return response;
}
