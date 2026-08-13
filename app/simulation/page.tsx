import { SCENARIOS } from "@/simulation/scenarios";
import { DemoStory, ScenarioRunner } from "@/components/interactive";
import { ActivityFeed } from "@/components/live";
import { SectionTitle } from "@/components/ui";

export default function SimulationPage() {
  const scenarios = SCENARIOS.map(({ id, label, description, expect }) => ({
    id,
    label,
    description,
    expect,
  }));

  return (
    <div className="space-y-5">
      <SectionTitle hint="Every scenario writes a real change before any agent runs">
        Business Simulator
      </SectionTitle>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <ScenarioRunner scenarios={scenarios} />
          <DemoStory />
        </div>
        <div className="xl:sticky xl:top-16 xl:self-start">
          <ActivityFeed height="h-[600px]" />
        </div>
      </div>
    </div>
  );
}
