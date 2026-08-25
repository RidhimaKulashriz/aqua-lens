import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alerts, assets, auditEvents, defects, evidence, InsertUser, missions, repairEstimates, reports, reviews, severityHistory, telemetry, users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { resolveReviewState } from "./services/reviewState";
import { storagePut } from "./storage";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "engineer");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

function insertId(result: unknown) {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { insertId?: number }).insertId ?? 0);
}

export async function getMissionOverview() {
  const db = await getDb();
  if (!db) return { assets: [], missions: [], defects: [], telemetry: [], reports: [], estimates: [], reviews: [], audit: [], alerts: [] };
  const [assetRows, missionRows, defectRows, telemetryRows, reportRows, estimateRows, reviewRows, auditRows, alertRows] = await Promise.all([
    db.select().from(assets).orderBy(desc(assets.updatedAt)).limit(40),
    db.select().from(missions).orderBy(desc(missions.createdAt)).limit(30),
    db.select().from(defects).orderBy(desc(defects.zeroErrorScore)).limit(120),
    db.select().from(telemetry).orderBy(desc(telemetry.capturedAt)).limit(240),
    db.select().from(reports).orderBy(desc(reports.createdAt)).limit(30),
    db.select().from(repairEstimates).orderBy(desc(repairEstimates.createdAt)).limit(120),
    db.select().from(reviews).orderBy(desc(reviews.createdAt)).limit(120),
    db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(120),
    db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(120),
  ]);
  return { assets: assetRows, missions: missionRows, defects: defectRows, telemetry: telemetryRows, reports: reportRows, estimates: estimateRows, reviews: reviewRows, audit: auditRows, alerts: alertRows };
}

export async function createDemoMissionRecord(input: { name: string; createdBy?: number | null; simulator: Awaited<ReturnType<typeof import("./services/simulator").buildSimulatorMission>> }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable. Configure DATABASE_URL before creating persistent missions.");
  const assetResult = await db.insert(assets).values({ name: "Rajpath Viaduct · North span", assetType: "bridge", locality: "New Delhi demo sector", latitude: "28.6139", longitude: "77.2090", criticality: 5, status: "watch" });
  const assetId = insertId(assetResult);
  const missionResult = await db.insert(missions).values({ assetId, createdBy: input.createdBy ?? null, name: input.name, mode: "demo", status: "completed", startedAt: new Date(input.simulator.startedAt), completedAt: new Date() });
  const missionId = insertId(missionResult);
  await db.insert(telemetry).values(input.simulator.telemetry.map(point => ({ missionId, latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6), altitudeMeters: Math.round(point.altitude), speedMps: Math.round(point.speedMps), batteryPercent: point.batteryPercent, capturedAt: new Date(point.timestamp) })));

  for (let index = 0; index < input.simulator.findings.length; index += 1) {
    const finding = input.simulator.findings[index]!;
    let evidenceId: number | null = null;
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%" height="100%" fill="#343434"/><path d="M0 600 L420 210 L860 720" stroke="#cfcfc8" stroke-width="92" fill="none"/><rect x="${460 + index * 55}" y="${240 + index * 35}" width="230" height="150" fill="none" stroke="#ffffff" stroke-width="6"/><text x="60" y="72" fill="#ffffff" font-size="30" font-family="Arial" letter-spacing="6">DRIFT / SIMULATED EVIDENCE</text><text x="60" y="670" fill="#ffffff" font-size="24" font-family="Arial">${finding.title.toUpperCase()} · ${Math.round(finding.confidence * 100)}% CONFIDENCE</text></svg>`;
      const stored = await storagePut(`drift/system/missions/${missionId}/simulated-evidence-${index + 1}.svg`, svg, "image/svg+xml");
      const evidenceResult = await db.insert(evidence).values({ missionId, fileName: `${finding.title.replace(/\s+/g, "-")}.svg`, mimeType: "image/svg+xml", storageKey: stored.key, storageUrl: stored.url, mediaKind: "annotation", latitude: finding.latitude.toFixed(6), longitude: finding.longitude.toFixed(6), playbackSeconds: finding.captureOffsetSeconds });
      evidenceId = insertId(evidenceResult);
    } catch (error) {
      console.warn("[DRIFT Storage] Simulator evidence record could not be persisted:", error);
    }
    const defectResult = await db.insert(defects).values({ missionId, assetId, evidenceId, defectType: finding.label, label: finding.title, confidencePercent: Math.round(finding.confidence * 100), zeroErrorScore: finding.score.score, severity: finding.score.severity, status: finding.score.severity === "critical" ? "under_review" : "detected", reviewState: "pending", latitude: finding.latitude.toFixed(6), longitude: finding.longitude.toFixed(6), boundingBox: finding.boundingBox, explanation: finding.score.explanation });
    const defectId = insertId(defectResult);
    await db.insert(severityHistory).values({ defectId, nextSeverity: finding.score.severity, score: finding.score.score, reason: finding.score.explanation.join("; "), changedBy: input.createdBy ?? null });
    await db.insert(repairEstimates).values({ defectId, estimateCents: finding.score.repairEstimateCents, currency: "INR", assumptions: { method: "ZeroError deterministic cost rule", defectType: finding.label }, status: "draft" });
    if (finding.score.severity === "critical" || finding.score.severity === "high") await db.insert(alerts).values({ missionId, defectId, severity: finding.score.severity, title: `${finding.score.severity.toUpperCase()} · ${finding.title}`, message: finding.score.urgency, status: "open" });
  }

  const reportTitle = `${input.name} · ZeroError inspection report`;
  const reportNarrative = "Demo report generated from simulated telemetry and explainable ML inference. Engineering sign-off is required before release.";
  let reportStorage: { key?: string; url?: string } = {};
  try {
    const body = `# ${reportTitle}\n\n${reportNarrative}\n\n## Findings\n\n${input.simulator.findings.map(finding => `- ${finding.title}: ${finding.score.severity} priority, ${finding.score.score}/100 ZeroError score, ${Math.round(finding.confidence * 100)}% confidence. ${finding.score.urgency}.`).join("\n")}\n\n## Control boundary\n\nAutomated findings are advisory. An authorised engineer must verify, override, or reject every repair priority before release.\n`;
    reportStorage = await storagePut(`drift/system/missions/${missionId}/zeroerror-report.md`, body, "text/markdown");
  } catch (error) {
    console.warn("[DRIFT Storage] Report record created without a downloadable attachment:", error);
  }
  await db.insert(reports).values({ missionId, title: reportTitle, narrative: reportNarrative, storageKey: reportStorage.key, storageUrl: reportStorage.url, status: "ready", generatedBy: "zeroerror-demo" });
  await db.insert(auditEvents).values({ missionId, actorId: input.createdBy ?? null, action: "simulator.mission_created", details: { findings: input.simulator.findings.length, mode: "demo" } });
  return { missionId, assetId };
}

export async function createEvidenceRecord(input: { missionId: number; uploadedBy?: number | null; fileName: string; mimeType: string; storageKey: string; storageUrl: string; mediaKind: "photo" | "video" | "annotation" | "report"; latitude?: string; longitude?: string; playbackSeconds?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable.");
  const result = await db.insert(evidence).values(input);
  return { id: insertId(result) };
}

export async function listMissionEvidence(missionId: number) { const db = await getDb(); return db ? db.select().from(evidence).where(eq(evidence.missionId, missionId)).orderBy(desc(evidence.createdAt)) : []; }
export async function listDemoEvidence(missionId: number) {
  const db = await getDb();
  if (!db) return [];
  const mission = (await db.select().from(missions).where(eq(missions.id, missionId)).limit(1))[0];
  if (!mission || mission.mode !== "demo") return [];
  const rows = await db.select().from(evidence).where(eq(evidence.missionId, missionId)).orderBy(desc(evidence.createdAt));
  return rows.filter(item => item.mediaKind === "annotation");
}

export async function addTelemetryRecord(input: { missionId: number; latitude: number; longitude: number; altitude: number; speedMps: number; batteryPercent: number; timestamp: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable.");
  const result = await db.insert(telemetry).values({ missionId: input.missionId, latitude: input.latitude.toFixed(6), longitude: input.longitude.toFixed(6), altitudeMeters: Math.round(input.altitude), speedMps: Math.round(input.speedMps), batteryPercent: Math.round(input.batteryPercent), capturedAt: new Date(input.timestamp) });
  await db.insert(auditEvents).values({ missionId: input.missionId, action: "hardware.telemetry_ingested", details: { source: "operator-approved adapter", batteryPercent: input.batteryPercent } });
  return { id: insertId(result) };
}

export async function listFilteredDefects(filters: { assetId?: number; missionId?: number; defectType?: "pothole" | "crack" | "structural"; severity?: "low" | "medium" | "high" | "critical"; status?: "detected" | "under_review" | "verified" | "scheduled" | "resolved" | "dismissed"; reviewState?: "pending" | "approved" | "overridden" | "rejected" }) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(defects).orderBy(desc(defects.zeroErrorScore)).limit(250);
  return rows.filter(defect => (!filters.assetId || defect.assetId === filters.assetId) && (!filters.missionId || defect.missionId === filters.missionId) && (!filters.defectType || defect.defectType === filters.defectType) && (!filters.severity || defect.severity === filters.severity) && (!filters.status || defect.status === filters.status) && (!filters.reviewState || defect.reviewState === filters.reviewState));
}

export async function listAlerts() { const db = await getDb(); return db ? db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(200) : []; }
export async function acknowledgeAlert(alertId: number, actorId: number) { const db = await getDb(); if (!db) throw new Error("Database is unavailable."); await db.update(alerts).set({ status: "acknowledged", acknowledgedBy: actorId, acknowledgedAt: new Date() }).where(eq(alerts.id, alertId)); return { success: true }; }
export async function listReportRecords() { const db = await getDb(); return db ? db.select().from(reports).orderBy(desc(reports.createdAt)).limit(100) : []; }
export async function listAuditEvents(missionId?: number) { const db = await getDb(); if (!db) return []; const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(300); return missionId ? rows.filter(row => row.missionId === missionId) : rows; }
export async function listAssets() { const db = await getDb(); return db ? db.select().from(assets).orderBy(desc(assets.updatedAt)).limit(100) : []; }
export async function createAssetRecord(input: { name: string; assetType: "bridge" | "road" | "rail" | "building" | "utility"; locality: string; latitude: string; longitude: string; criticality: number }) { const db = await getDb(); if (!db) throw new Error("Database is unavailable."); const result = await db.insert(assets).values({ ...input, status: "operational" }); return { id: insertId(result) }; }
export async function updateAssetRecord(id: number, input: Partial<{ name: string; assetType: "bridge" | "road" | "rail" | "building" | "utility"; locality: string; latitude: string; longitude: string; criticality: number; status: "operational" | "watch" | "restricted" | "closed" }>) { const db = await getDb(); if (!db) throw new Error("Database is unavailable."); await db.update(assets).set(input).where(eq(assets.id, id)); return { success: true }; }
export async function deleteAssetRecord(id: number) { const db = await getDb(); if (!db) throw new Error("Database is unavailable."); const dependentMission = (await db.select().from(missions).where(eq(missions.assetId, id)).limit(1))[0]; if (dependentMission) throw new Error("Assets with mission history cannot be deleted; set a restricted or closed status instead."); await db.delete(assets).where(eq(assets.id, id)); return { success: true }; }
export async function getMapData(filters: Parameters<typeof listFilteredDefects>[0]) { const rows = await listFilteredDefects(filters); return rows.map(defect => ({ id: defect.id, missionId: defect.missionId, assetId: defect.assetId, defectType: defect.defectType, severity: defect.severity, status: defect.status, reviewState: defect.reviewState, zeroErrorScore: defect.zeroErrorScore, latitude: Number(defect.latitude), longitude: Number(defect.longitude) })); }

export async function addReview(input: { defectId: number; reviewerId?: number | null; decision: "approve" | "override" | "reject" | "needs_site_visit"; priorityOverride?: "low" | "medium" | "high" | "critical"; note: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable.");
  const result = await db.insert(reviews).values(input);
  const defect = (await db.select().from(defects).where(eq(defects.id, input.defectId)).limit(1))[0];
  if (defect) {
    const next = resolveReviewState(input.decision, defect.severity, input.priorityOverride);
    await db.update(defects).set(next).where(eq(defects.id, input.defectId));
    await db.insert(severityHistory).values({ defectId: defect.id, previousSeverity: defect.severity, nextSeverity: next.severity, score: defect.zeroErrorScore, reason: `Engineer ${input.decision}: ${input.note}`, changedBy: input.reviewerId ?? null });
    await db.insert(auditEvents).values({ missionId: defect.missionId, defectId: defect.id, actorId: input.reviewerId ?? null, action: `review.${input.decision}`, details: { note: input.note, priorityOverride: input.priorityOverride ?? null } });
  }
  return { id: insertId(result) };
}
