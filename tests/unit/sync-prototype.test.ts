import { describe, expect, it } from "vitest";
import { editDemo, initialSyncDemo, pendingDemo, resolveDemo, syncDemo } from "@/lib/integration/sync-prototype";

describe("continuous sync prototype", () => {
  it("syncs both directions, acknowledges changes and is idempotent", () => {
    let s = editDemo(initialSyncDemo(), "app", "PLOT-042", "Booked");
    s = editDemo(s, "crm", "EMP-008", "On leave");
    expect(pendingDemo(s)).toBe(2);
    s = syncDemo(s, 1000);
    expect(s.app).toEqual(s.crm);
    expect(s.checkpoint).toEqual({ app: 1, crm: 1 });
    expect(pendingDemo(s)).toBe(0);
    expect(syncDemo(s, 2000).app).toEqual(s.app);
  });
  it("retains changes and checkpoints during an outage and catches up later", () => {
    let s = editDemo(initialSyncDemo(), "crm", "EMP-008", "Inactive");
    s.online = false;
    s = syncDemo(s, 1000);
    expect(s.checkpoint.crm).toBe(0);
    expect(s.retries).toBe(1);
    expect(pendingDemo(s)).toBe(1);
    s.online = true;
    s = syncDemo(s, 2000);
    expect(s.app[0].status).toBe("Inactive");
    expect(s.checkpoint.crm).toBe(1);
  });
  it("requires explicit conflict resolution and preserves unrelated changes", () => {
    let s = editDemo(initialSyncDemo(), "app", "EMP-008", "On leave");
    s = editDemo(s, "crm", "EMP-008", "Inactive");
    s = editDemo(s, "app", "PLOT-042", "Booked");
    s = syncDemo(s, 1000);
    expect(s.conflicts).toEqual(["EMP-008"]);
    expect(s.app[0].status).toBe("On leave");
    expect(s.crm[0].status).toBe("Inactive");
    expect(s.crm[1].status).toBe("Booked");
    expect(s.checkpoint).toEqual({ app: 0, crm: 0 });
    s = resolveDemo(s, "EMP-008", "crm");
    s = syncDemo(s, 2000);
    expect(s.app[0].status).toBe("Inactive");
    expect(s.conflicts).toEqual([]);
    expect(s.checkpoint).toEqual(s.sequence);
  });
  it("full reconciliation repairs drift even without a source sequence increment", () => {
    const s = initialSyncDemo();
    s.crm[2].status = "Qualified";
    const fixed = syncDemo(s, 5000, true);
    expect(fixed.app[2].status).toBe("Qualified");
    expect(fixed.lastReconcile).toBe(5000);
  });
});
