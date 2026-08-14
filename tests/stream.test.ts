/**
 * SSE stream tests.
 *
 * The UI casts every frame to `BusinessEvent` and reads `payload` without
 * checking. The open frame shipped without one and threw in the first consumer
 * that trusted the type, so the shape of what goes on the wire is asserted here
 * rather than discovered on a dashboard.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/events/stream/route";
import { getBus } from "@/events/bus";
import { seedDemo } from "@/simulation/seed";
import type { BusinessEvent } from "@/types";

beforeAll(() => {
  seedDemo();
});

/** Opens the stream and returns the first `count` frames, then aborts it. */
async function readFrames(count: number, act?: () => void): Promise<BusinessEvent[]> {
  const controller = new AbortController();
  const response = await GET(new Request("http://localhost/api/events/stream", {
    signal: controller.signal,
  }));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: BusinessEvent[] = [];
  let buffer = "";

  act?.();

  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0 && frames.length < count) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (chunk.startsWith("data: ")) frames.push(JSON.parse(chunk.slice(6)));
    }
  }

  controller.abort();
  await reader.cancel().catch(() => {});
  return frames;
}

describe("event stream", () => {
  it("opens with a frame the UI can read without a guard", async () => {
    const [open] = await readFrames(1);

    expect(open.type).toBe("STREAM_OPEN");
    // The whole bug: this was undefined, and every consumer dereferences it.
    expect(open.payload).toBeTypeOf("object");
    expect(open.payload).not.toBeNull();
    expect(open.createdAt).toBeTruthy();
  });

  it("forwards published events with their payload intact", async () => {
    const [, published] = await readFrames(2, () => {
      getBus().publish(
        "AGENT_STATUS_CHANGED",
        { agentId: "analytics", activity: "probing the stream" },
        { source: "analytics", correlationId: "cor_test" },
      );
    });

    expect(published.type).toBe("AGENT_STATUS_CHANGED");
    expect((published.payload as { agentId: string }).agentId).toBe("analytics");
  });
});
