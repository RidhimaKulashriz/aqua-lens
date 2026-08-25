import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { requireDriftRole } from "./services/authorization";
import { getHardwareConnection, probeHardwareConnection, validateTelemetryPayload } from "./services/hardwareAdapter";
import { runVisionInference } from "./services/mlInference";
import { resolveReviewState } from "./services/reviewState";
import { scoreZeroError } from "./services/scoring";
import { buildSimulatorMission } from "./services/simulator";

describe("ZeroError scoring", () => {
  it("prioritizes a high-confidence structural finding above routine defects", () => {
    const critical = scoreZeroError({ defectType: "structural", confidence: 0.94, latitude: 28.61, longitude: 77.2, priorOpenDefects: 2, assetCriticality: 5 });
    const low = scoreZeroError({ defectType: "pothole", confidence: 0.76, latitude: 28.61, longitude: 77.2, priorOpenDefects: 0, assetCriticality: 1 });
    expect(critical.score).toBeGreaterThan(low.score);
    expect(critical.severity).toBe("critical");
  });
});

describe("hardware adapter safeguards", () => {
  it("falls back safely when no hardware endpoint is configured", () => {
    expect(getHardwareConnection().status).toBe("offline");
    expect(getHardwareConnection().operatorMessage).toMatch(/Simulator mode/);
  });

  it("rejects incomplete telemetry payloads", () => {
    expect(validateTelemetryPayload({ latitude: 1 }).valid).toBe(false);
    expect(validateTelemetryPayload({ latitude: 1, longitude: 2, altitude: 5, batteryPercent: 90, timestamp: 1 }).valid).toBe(true);
  });

  it("surfaces a retry state when a configured bridge is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await probeHardwareConnection("https://bridge.example.test/health");
    expect(result.status).toBe("retrying");
    expect(result.retryAfterSeconds).toBe(30);
    vi.unstubAllGlobals();
  });

  it("surfaces a connected state after a successful health response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await probeHardwareConnection("https://bridge.example.test/health");
    expect(result.status).toBe("connected");
    expect(result.lastHeartbeatAt).toEqual(expect.any(Number));
    vi.unstubAllGlobals();
  });
});

describe("vision inference adapter", () => {
  it("returns explainable structural inference for bridge evidence", async () => {
    const inference = await runVisionInference({ fileName: "bridge_structural_frame.jpg", latitude: 28.61, longitude: 77.2, assetCriticality: 5, priorOpenDefects: 1, demo: true });
    expect(inference.label).toBe("structural");
    expect(inference.score.explanation.length).toBeGreaterThan(2);
  });
});

describe("simulator lifecycle", () => {
  it("creates a complete no-hardware patrol with telemetry and prioritized findings", async () => {
    const mission = await buildSimulatorMission("Integration demo");
    expect(mission.name).toBe("Integration demo");
    expect(mission.telemetry).toHaveLength(12);
    expect(mission.findings).toHaveLength(3);
    expect(mission.findings.map(finding => finding.label)).toEqual(expect.arrayContaining(["structural", "crack", "pothole"]));
    expect(mission.findings[0]?.score.severity).toBe("critical");
  });
});

describe("engineering review state and role boundary", () => {
  it("records an explicit severity override while retaining a verified outcome", () => {
    expect(resolveReviewState("override", "critical", "high")).toEqual({ severity: "high", reviewState: "overridden", status: "verified" });
    expect(resolveReviewState("needs_site_visit", "medium")).toEqual({ severity: "medium", reviewState: "pending", status: "under_review" });
  });

  it("allows engineers while blocking citizen operational changes", () => {
    expect(() => requireDriftRole({ role: "engineer" }, ["admin", "engineer"])).not.toThrow();
    expect(() => requireDriftRole({ role: "citizen" }, ["admin", "engineer"])).toThrow(/does not permit/);
  });
});

describe("public tRPC operations", () => {
  it("exposes safe hardware, filter, map, alert, and report read operations", async () => {
    const ctx = { user: null, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] } as TrpcContext;
    const caller = appRouter.createCaller(ctx);
    const [hardware, defects, mapData, alerts, reportRecords, demoEvidence] = await Promise.all([
      caller.drift.hardwareStatus(),
      caller.drift.filters.defects({}),
      caller.drift.filters.mapData({}),
      caller.drift.alerts.list(),
      caller.drift.reports.list(),
      caller.drift.evidence.demoList({ missionId: 60001 }),
    ]);
    expect(["offline", "connected", "retrying", "degraded"]).toContain(hardware.status);
    expect(Array.isArray(defects)).toBe(true);
    expect(Array.isArray(mapData)).toBe(true);
    expect(Array.isArray(alerts)).toBe(true);
    expect(Array.isArray(reportRecords)).toBe(true);
    expect(Array.isArray(demoEvidence)).toBe(true);
  });
});

describe("authorized workspace roles", () => {
  const baseContext = { req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
  const userFor = (role: "admin" | "engineer" | "citizen") => ({ id: 1, openId: `${role}-user`, name: role, email: null, loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() });

  it("returns role-specific server-authorized workspace permissions", async () => {
    const admin = await appRouter.createCaller({ ...baseContext, user: userFor("admin") } as TrpcContext).drift.workspace();
    const engineer = await appRouter.createCaller({ ...baseContext, user: userFor("engineer") } as TrpcContext).drift.workspace();
    const citizen = await appRouter.createCaller({ ...baseContext, user: userFor("citizen") } as TrpcContext).drift.workspace();
    expect(admin.permissions).toContain("asset:delete");
    expect(engineer.permissions).toContain("review");
    expect(citizen.permissions).toEqual(["public:read"]);
  });

  it("rejects protected administrator and engineering actions for unauthorized roles before database mutation", async () => {
    const citizen = appRouter.createCaller({ ...baseContext, user: userFor("citizen") } as TrpcContext);
    const engineer = appRouter.createCaller({ ...baseContext, user: userFor("engineer") } as TrpcContext);
    await expect(citizen.drift.assets.create({ name: "Blocked asset", assetType: "bridge", locality: "Delhi", latitude: "28.61", longitude: "77.20", criticality: 4 })).rejects.toThrow(/does not permit/);
    await expect(engineer.drift.assets.delete({ id: 999999 })).rejects.toThrow(/does not permit/);
    await expect(citizen.drift.review({ defectId: 1, decision: "approve", note: "Citizen review attempt" })).rejects.toThrow(/does not permit/);
  });
});
