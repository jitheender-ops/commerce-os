import { listMemory } from "@/database/queries";
import { MemoryPanel } from "@/components/interactive";
import { SectionTitle } from "@/components/ui";

export default function MemoryPage() {
  return (
    <div className="space-y-5">
      <SectionTitle hint="Working, episodic, semantic, operational and policy layers">
        Agent Memory
      </SectionTitle>
      <MemoryPanel initial={listMemory(undefined, 200)} />
    </div>
  );
}
