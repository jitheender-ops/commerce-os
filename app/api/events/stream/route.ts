/**
 * Server-sent event stream.
 *
 * The UI subscribes once and receives every event the bus publishes, including
 * the ephemeral lifecycle events (agent status, tool calls) that are never
 * written to the database. A heartbeat keeps intermediaries from closing an
 * idle connection.
 */
import { getBus } from "@/events/bus";
import { ready } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  ready();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      send({ type: "STREAM_OPEN", createdAt: new Date().toISOString() });

      const unsubscribe = getBus().subscribe("*", (event) => send(event));
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disables proxy buffering, which would otherwise batch the stream.
      "x-accel-buffering": "no",
    },
  });
}
