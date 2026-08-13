import { clearMemory, listMemory } from "@/database/queries";
import { handle, ok, ready, searchParam } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    ready();
    const agentId = searchParam(request, "agent");
    const memories = listMemory(agentId, 200);
    return ok({
      memories,
      byKind: memories.reduce<Record<string, number>>((acc, memory) => {
        acc[memory.kind] = (acc[memory.kind] ?? 0) + 1;
        return acc;
      }, {}),
    });
  } catch (error) {
    return handle(error, "memory");
  }
}

export async function DELETE(request: Request) {
  try {
    ready();
    const removed = clearMemory(searchParam(request, "agent"));
    return ok({ removed });
  } catch (error) {
    return handle(error, "memory:clear");
  }
}
