import { describe, expect, it } from "vitest";
import { Sim } from "@/engine/test-utils";
import { DEFAULT_DEMO_PROTOCOL_ID, DEMO_PROTOCOLS, practiceStepsFor } from ".";

const protocol = DEMO_PROTOCOLS.find((p) => p.id === DEFAULT_DEMO_PROTOCOL_ID)!;

describe("hands-only demo in the product engine", () => {
  it("finishes camera practice without a pen, then confirms gestures and a fresh five-second hold", () => {
    const sim = new Sim(protocol.steps, { practiceSteps: practiceStepsFor(protocol) });
    sim.startPractice();
    sim.frames("practice-show-one-hand", 3);
    expect(sim.state.practiceCompleted).toBe(true);
    sim.start();
    sim.frames("show-open-hands", 3);
    sim.frames("show-thumbs-up", 3);
    sim.frames("hold-closed-fist", 3);
    expect(sim.status).toBe("active");
    sim.frames("hold-closed-fist", 6);
    expect(sim.status).toBe("completed");
    expect(sim.events.filter((e) => e.type === "step_confirmed" && e.run === "real")).toHaveLength(
      3,
    );
  });

  it("stops when a thumbs-up is observed before the critical open-hands step", () => {
    const sim = new Sim(protocol.steps);
    sim.start();
    sim.frames("show-thumbs-up", 2);
    expect(sim.status).toBe("active");
    sim.frame("show-thumbs-up");
    expect(sim.state.stopReason).toMatchObject({
      kind: "critical_miss",
      missedStepId: "show-open-hands",
      observedStepId: "show-thumbs-up",
    });
    expect(sim.last("critical_miss")?.evidenceSeq).toBe(sim.seq);
  });

  it("cannot complete the final fist hold from elapsed time without matching frames", () => {
    const sim = new Sim(protocol.steps);
    sim.start();
    sim.frames("show-open-hands", 3);
    sim.frames("show-thumbs-up", 3);
    sim.frames("hold-closed-fist", 3);
    sim.tick(6_000);
    expect(sim.status).not.toBe("completed");
    expect(sim.progress("hold-closed-fist").status).not.toBe("confirmed");
  });
});
