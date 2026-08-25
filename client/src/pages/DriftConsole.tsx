import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BatteryCharging,
  CheckCheck,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  CloudCog,
  Crosshair,
  FileText,
  Gauge,
  Layers3,
  MapPinned,
  Network,
  Play,
  Radar,
  RadioTower,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Upload,
  Video,
  Waypoints,
  Wrench,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

type Severity = "low" | "medium" | "high" | "critical";
type Workspace = "operations" | "defects" | "evidence" | "reports" | "hardware";
type Role = "administrator" | "engineer" | "citizen";
type EvidenceItem = { id: number; fileName: string; storageUrl: string; mediaKind: "photo" | "video" | "annotation" | "report"; latitude: string | null; longitude: string | null };

const fallbackDefects = [
  { id: 101, label: "North pier spalling", defectType: "structural", severity: "critical" as Severity, zeroErrorScore: 91, confidencePercent: 94, latitude: "28.6171", longitude: "77.2128", status: "under_review", reviewState: "pending", missionId: 1, assetId: 1, explanation: ["94% model confidence", "structural risk baseline", "Asset criticality 5/5"] },
  { id: 102, label: "Eastbound longitudinal crack", defectType: "crack", severity: "high" as Severity, zeroErrorScore: 73, confidencePercent: 88, latitude: "28.6142", longitude: "77.2086", status: "detected", reviewState: "pending", missionId: 1, assetId: 1, explanation: ["88% model confidence", "crack risk baseline", "Asset criticality 4/5"] },
  { id: 103, label: "Service lane pothole", defectType: "pothole", severity: "medium" as Severity, zeroErrorScore: 48, confidencePercent: 82, latitude: "28.6110", longitude: "77.2051", status: "detected", reviewState: "pending", missionId: 1, assetId: 1, explanation: ["82% model confidence", "pothole risk baseline", "No related open defects nearby"] },
];

const fallbackTelemetry = Array.from({ length: 11 }, (_, index) => ({
  id: index,
  latitude: (28.606 + index * 0.0012).toFixed(5),
  longitude: (77.194 + index * 0.0017).toFixed(5),
  altitudeMeters: 34 + (index % 3) * 3,
  speedMps: 8 + (index % 2),
  batteryPercent: 93 - index * 3,
}));

const fallbackMissions = [{ id: 1, name: "DELHI / NORTH CORRIDOR", status: "active", mode: "demo", assetId: 1 }];

const fallbackReports = [{ id: 1, title: "North corridor · ZeroError inspection report", narrative: "Three repair candidates detected during scheduled patrol. The north pier requires priority engineer review before the next traffic peak.", status: "ready", storageUrl: undefined as string | undefined, createdAt: new Date() }];

const navItems: Array<{ key: Workspace; label: string; icon: typeof Radar }> = [
  { key: "operations", label: "Operations", icon: Radar },
  { key: "defects", label: "Defect control", icon: TriangleAlert },
  { key: "evidence", label: "Evidence vault", icon: Video },
  { key: "reports", label: "Reports", icon: FileText },
  { key: "hardware", label: "Hardware bridge", icon: RadioTower },
];

function severityClass(severity: Severity) {
  return severity === "critical" ? "severity-critical" : severity === "high" ? "severity-high" : severity === "medium" ? "severity-medium" : "severity-low";
}

function formatCurrency(cents = 0) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(cents / 100);
}

function SeverityChip({ severity }: { severity: Severity }) {
  return <span className={cn("severity-chip", severityClass(severity))}>{severity}</span>;
}

function StatBlock({ label, value, detail, direction = "neutral" }: { label: string; value: string; detail: string; direction?: "up" | "down" | "neutral" }) {
  return (
    <section className="stat-block">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <span className={cn("stat-detail", direction === "up" && "detail-up", direction === "down" && "detail-down")}>
        {direction === "up" ? <ArrowUpRight /> : direction === "down" ? <ArrowDownRight /> : <CircleDot />} {detail}
      </span>
    </section>
  );
}

function WorkbenchMap({ defects, telemetry, selectedId, onSelect }: { defects: typeof fallbackDefects; telemetry: typeof fallbackTelemetry; selectedId: number; onSelect: (id: number) => void }) {
  return (
    <div className="map-canvas" aria-label="Geospatial defect map">
      <div className="map-grid" />
      <div className="map-cross map-cross-x" />
      <div className="map-cross map-cross-y" />
      <span className="map-coordinate top">28.6180 N</span>
      <span className="map-coordinate bottom">77.2040 E</span>
      <div className="river-band" />
      <div className="road-road road-one" />
      <div className="road-road road-two" />
      <svg className="flight-route" viewBox="0 0 600 340" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={telemetry.map((_, index) => `${40 + index * 48},${275 - index * 18}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 7" />
      </svg>
      {telemetry.map((_, index) => <span key={index} className="telemetry-dot" style={{ left: `${7 + index * 8}%`, bottom: `${15 + index * 5.1}%` }} />)}
      {defects.map((defect, index) => (
        <button key={defect.id} type="button" className={cn("defect-marker", severityClass(defect.severity), selectedId === defect.id && "is-selected")} style={{ left: `${66 - index * 22}%`, top: `${20 + index * 28}%` }} onClick={() => onSelect(defect.id)}>
          <span>{String(index + 1).padStart(2, "0")}</span>
        </button>
      ))}
      <div className="map-legend"><span><i className="pulse-dot" /> live telemetry</span><span><i className="route-dot" /> approved flight corridor</span></div>
    </div>
  );
}

export default function DriftConsole() {
  const [workspace, setWorkspace] = useState<Workspace>("operations");
  const [previewRole, setPreviewRole] = useState<Role>("engineer");
  const [selectedId, setSelectedId] = useState(101);
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [defectTypeFilter, setDefectTypeFilter] = useState<"all" | "pothole" | "crack" | "structural">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "detected" | "under_review" | "verified" | "scheduled" | "resolved" | "dismissed">("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | "pending" | "approved" | "overridden" | "rejected">("all");
  const [missionFilter, setMissionFilter] = useState<number | "all">("all");
  const [assetFilter, setAssetFilter] = useState<number | "all">("all");
  const [missionName, setMissionName] = useState("Demo corridor patrol");
  const [aiBrief, setAiBrief] = useState<string | null>(null);
  const { user, isAuthenticated } = useAuth();
  const overview = trpc.drift.overview.useQuery(undefined, { refetchInterval: 15000 });
  const hardware = trpc.drift.hardwareStatus.useQuery(undefined);
  const workspaceAccess = trpc.drift.workspace.useQuery(undefined, { enabled: isAuthenticated });
  const utils = trpc.useUtils();
  const filePickerRef = useRef<HTMLInputElement>(null);
  const runSimulator = trpc.drift.runSimulator.useMutation({
    onSuccess: data => {
      toast.success(`Simulator mission stored · ${data.findings.length} findings evaluated`);
      utils.drift.overview.invalidate();
      setWorkspace("operations");
    },
    onError: error => toast.error(error.message),
  });

  const live = overview.data;
  const defects = (live?.defects.length ? live.defects : fallbackDefects) as typeof fallbackDefects;
  const missions = (live?.missions.length ? live.missions : fallbackMissions) as typeof fallbackMissions;
  const telemetry = (live?.telemetry.length ? live.telemetry.slice(0, 11) : fallbackTelemetry) as typeof fallbackTelemetry;
  const reports = (live?.reports.length ? live.reports : fallbackReports) as typeof fallbackReports;
  const missionIdForEvidence = Number(live?.missions[0]?.id ?? 0);
  const missionEvidence = trpc.drift.evidence.list.useQuery({ missionId: missionIdForEvidence }, { enabled: workspace === "evidence" && missionIdForEvidence > 0 });
  const demoEvidence = trpc.drift.evidence.demoList.useQuery({ missionId: missionIdForEvidence }, { enabled: workspace === "evidence" && missionIdForEvidence > 0 });
  const evidenceItems: EvidenceItem[] = missionEvidence.data?.length ? missionEvidence.data : demoEvidence.data ?? [];
  const uploadEvidence = trpc.drift.evidence.upload.useMutation({
    onSuccess: () => {
      toast.success("Evidence stored securely with mission metadata");
      missionEvidence.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const reviewMutation = trpc.drift.review.useMutation({
    onSuccess: () => {
      toast.success("Engineer decision persisted to audit history");
      utils.drift.overview.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const decisionSupport = trpc.drift.decisionSupport.useMutation({
    onSuccess: result => {
      setAiBrief(result.engineeringNarrative);
      toast.success("ZeroError engineering narrative generated for manual review");
    },
    onError: error => toast.error(error.message),
  });
  const selected = defects.find(defect => defect.id === selectedId) ?? defects[0];
  const visibleDefects = useMemo(() => defects.filter(defect =>
    (severityFilter === "all" || defect.severity === severityFilter) &&
    (defectTypeFilter === "all" || defect.defectType === defectTypeFilter) &&
    (statusFilter === "all" || defect.status === statusFilter) &&
    (reviewFilter === "all" || defect.reviewState === reviewFilter) &&
    (missionFilter === "all" || defect.missionId === missionFilter) &&
    (assetFilter === "all" || defect.assetId === assetFilter),
  ), [defects, severityFilter, defectTypeFilter, statusFilter, reviewFilter, missionFilter, assetFilter]);
  const repairTotal = (live?.estimates ?? []).reduce((sum, item) => sum + item.estimateCents, 0) || 2347000;
  const criticalCount = defects.filter(defect => defect.severity === "critical").length;
  const connectedStatus = hardware.data?.status ?? "offline";
  const activeAlerts = (live?.alerts ?? []).filter(alert => alert.status === "open");
  const availableAssets = live?.assets ?? [];
  const availableMissions = live?.missions ?? [];
  const role: Role = isAuthenticated ? (workspaceAccess.data?.role === "admin" ? "administrator" : workspaceAccess.data?.role === "citizen" ? "citizen" : "engineer") : previewRole;
  const roleSource = isAuthenticated ? "AUTHORISED ROLE" : "DEMO PREVIEW";
  const canOperate = !isAuthenticated || role !== "citizen";

  const roleCopy: Record<Role, { eyebrow: string; title: string; note: string }> = {
    administrator: { eyebrow: "GOVERNANCE DESK", title: "Network accountability", note: "Audit integrity, service levels, and asset exposure across the inspection network." },
    engineer: { eyebrow: "ENGINEERING DESK", title: "Verify before you release", note: "Review evidence, override priorities, and turn risk signals into accountable maintenance actions." },
    citizen: { eyebrow: "PUBLIC STATUS DESK", title: "Safer infrastructure, visible progress", note: "View current asset status and resolved safety actions without access to operational controls." },
  };

  const auditAction = (action: string) => toast.success(`${action} recorded in this review session`);
  const submitReview = (decision: "approve" | "override" | "needs_site_visit") => {
    reviewMutation.mutate({
      defectId: selected.id,
      decision,
      priorityOverride: decision === "override" ? "high" : undefined,
      note: decision === "approve" ? "Evidence reviewed and priority accepted." : decision === "override" ? "Priority adjusted after engineer review." : "Field verification requested before work-order release.",
    });
  };
  const handleEvidenceFile = (file?: File) => {
    if (!file) return;
    if (!missionIdForEvidence) {
      toast.error("Run a simulator mission or select a persisted mission before uploading evidence.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => uploadEvidence.mutate({
      missionId: missionIdForEvidence,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      base64: String(reader.result),
      mediaKind: file.type.startsWith("video/") ? "video" : "photo",
      latitude: String(selected.latitude),
      longitude: String(selected.longitude),
      playbackSeconds: 0,
    });
    reader.onerror = () => toast.error("The selected evidence file could not be read.");
    reader.readAsDataURL(file);
  };
  const createAiBrief = () => decisionSupport.mutate({
    defectType: selected.defectType,
    location: `${selected.latitude}, ${selected.longitude}`,
    missionName: missions[0]?.name ?? "DRIFT mission",
    score: {
      score: selected.zeroErrorScore,
      severity: selected.severity,
      urgency: selected.severity === "critical" ? "Isolate and dispatch within 4 hours" : selected.severity === "high" ? "Engineer review within 24 hours" : "Plan repair in the next maintenance cycle",
      explanation: selected.explanation ?? [],
      repairEstimateCents: repairTotal,
    },
  });

  return (
    <div className="drift-shell">
      <aside className="command-rail">
        <div className="brand-mark"><span className="brand-square" /><span>DRIFT</span></div>
        <p className="rail-subtitle">DRONE BASED RECONNAISSANCE<br />&amp; FAULT TRACKING</p>
        <nav aria-label="DRIFT workspace navigation">
          {navItems.map(item => {
            const Icon = item.icon;
            return <button key={item.key} type="button" className={cn("nav-item", workspace === item.key && "active")} onClick={() => setWorkspace(item.key)}><Icon /><span>{item.label}</span><ChevronRight /></button>;
          })}
        </nav>
        <div className="rail-status">
          <span className={cn("connection-lamp", connectedStatus === "connected" && "connected", connectedStatus === "degraded" && "degraded")} />
          <div><span className="eyebrow">ADAPTER</span><strong>{connectedStatus}</strong></div>
        </div>
        <div className="rail-footer"><span>ZEROERROR / 01</span><span>V 1.0.0</span></div>
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div className="crumbs"><span>OPERATIONS</span><b>/</b><span>{workspace.toUpperCase()}</span></div>
          <div className="topbar-actions">
            <button type="button" className="role-toggle" disabled={isAuthenticated} onClick={() => setPreviewRole(role === "administrator" ? "engineer" : role === "engineer" ? "citizen" : "administrator")}><ShieldCheck /> {roleSource} · {role}</button>
            {canOperate && <button type="button" className="primary-action" onClick={() => runSimulator.mutate({ name: missionName })} disabled={runSimulator.isPending}><Play /> {runSimulator.isPending ? "SIMULATING" : "RUN DEMO"}</button>}
          </div>
        </header>

        <section className="identity-band">
          <div>
            <p className="eyebrow">{roleCopy[role].eyebrow}</p>
            <h1>{roleCopy[role].title}</h1>
          </div>
          <p>{roleCopy[role].note}</p>
          <div className="identity-code"><span>LIVE SYSTEM</span><strong>• 8A</strong></div>
        </section>

        <section className="safety-banner">
          <CloudCog />
          <div><strong>SIMULATOR READY</strong><span>{hardware.data?.operatorMessage ?? "No hardware endpoint configured. All data, alerts, reports, and reviews can be demonstrated safely without a drone."}</span></div>
          <button type="button" onClick={() => setWorkspace("hardware")}>VIEW BRIDGE <ChevronRight /></button>
        </section>

        {activeAlerts.length > 0 && <section className="alert-strip"><AlertTriangle /><div><span className="eyebrow">OPEN MAINTENANCE ALERTS</span><strong>{activeAlerts[0]?.title}</strong><small>{activeAlerts[0]?.message}</small></div><button type="button" onClick={() => { setSeverityFilter("critical"); setWorkspace("defects"); }}>REVIEW {activeAlerts.length} ALERT{activeAlerts.length === 1 ? "" : "S"} <ChevronRight /></button></section>}

        {workspace === "operations" && <>
          <section className="stats-grid">
            <StatBlock label="ACTIVE MISSIONS" value={String(missions.length).padStart(2, "0")} detail="demo-ready patrol" direction="up" />
            <StatBlock label="OPEN FINDINGS" value={String(defects.length).padStart(2, "0")} detail={`${criticalCount} critical review`} direction="down" />
            <StatBlock label="EXPOSURE ESTIMATE" value={formatCurrency(repairTotal)} detail="repair rules v1.0" />
            <StatBlock label="FLEET BATTERY" value={`${telemetry[0]?.batteryPercent ?? 93}%`} detail="18 min reserve" direction="up" />
          </section>

          <section className="operations-grid">
            <article className="panel map-panel">
              <div className="panel-heading"><div><span className="eyebrow">GEO-SPATIAL WORKBENCH</span><h2>Live defect field</h2></div><button type="button" className="icon-button"><SlidersHorizontal /></button></div>
              <WorkbenchMap defects={defects} telemetry={telemetry} selectedId={selected.id} onSelect={setSelectedId} />
              <div className="mission-strip"><div><span className="eyebrow">CURRENT MISSION</span><strong>{missions[0]?.name}</strong></div><div><span className="eyebrow">FLIGHT STATE</span><strong className="status-active">{missions[0]?.status ?? "active"}</strong></div><div><span className="eyebrow">WAYPOINTS</span><strong>12 / 12</strong></div><button type="button" onClick={() => auditAction("Flight playback")}>PLAYBACK <Play /></button></div>
            </article>

            <article className="panel priority-panel">
              <div className="panel-heading"><div><span className="eyebrow">ZEROERROR QUEUE</span><h2>Action first</h2></div><span className="queue-count">{defects.length}</span></div>
              <div className="priority-list">
                {defects.slice(0, 4).map(defect => <button type="button" key={defect.id} className={cn("priority-item", selected.id === defect.id && "selected")} onClick={() => setSelectedId(defect.id)}><span className={cn("item-index", severityClass(defect.severity))}>{String(defect.id).slice(-2)}</span><span className="priority-content"><strong>{defect.label}</strong><small>{defect.confidencePercent}% confidence · score {defect.zeroErrorScore}</small></span><SeverityChip severity={defect.severity} /></button>)}
              </div>
              <button type="button" className="secondary-action full" onClick={() => setWorkspace("defects")}>OPEN MAINTENANCE QUEUE <ChevronRight /></button>
            </article>
          </section>

          <section className="lower-grid">
            <article className="panel evidence-panel">
              <div className="panel-heading"><div><span className="eyebrow">EVIDENCE REVIEW</span><h2>{selected.label}</h2></div><span className="evidence-time">T+ 02:13</span></div>
              <div className="evidence-frame"><div className="scan-lines" /><div className="inspection-structure"><span /><span /><span /></div><div className="bounding-box"><b>{selected.defectType.toUpperCase()}</b><small>{selected.confidencePercent}% confidence</small></div><div className="frame-metrics"><span>GPS {selected.latitude} / {selected.longitude}</span><span>ALT 38M</span><span>CAM 01</span></div></div>
              <div className="explain-row"><ScanLine /><p>{selected.explanation?.join(" · ")}</p><button type="button" onClick={() => setWorkspace("evidence")}>REVIEW <ChevronRight /></button></div>
            </article>

            <article className="panel decision-panel">
              <div className="panel-heading"><div><span className="eyebrow">ENGINEER DECISION</span><h2>Human checkpoint</h2></div><ClipboardCheck /></div>
              <div className="decision-score"><span className={cn("score-orb", severityClass(selected.severity))}>{selected.zeroErrorScore}</span><div><span className="eyebrow">ZEROERROR PRIORITY</span><h3>{selected.severity} intervention</h3><p>AI is advisory. An authorised engineer must approve, override, or request a site visit.</p></div></div>
              {!canOperate ? <div className="citizen-notice">Public view only. Engineering decision controls remain unavailable for the authenticated citizen role.</div> : <div className="decision-actions"><button type="button" onClick={() => submitReview("approve")}><CheckCheck /> APPROVE</button><button type="button" onClick={() => submitReview("override")}><Wrench /> OVERRIDE</button><button type="button" onClick={() => submitReview("needs_site_visit")}><MapPinned /> SITE VISIT</button></div>}
            </article>
          </section>
          {role === "administrator" && <section className="admin-grid"><article className="panel admin-panel"><div className="panel-heading"><div><span className="eyebrow">ADMINISTRATOR WORKSPACE</span><h2>Asset governance</h2></div><Layers3 /></div><div className="governance-list">{availableAssets.slice(0, 4).map(asset => <div key={asset.id}><strong>{asset.name}</strong><span>{asset.assetType} · criticality {asset.criticality}/5 · {asset.status}</span></div>) || <p>No managed assets are available yet.</p>}</div><p className="access-note">Asset create, update, and delete actions are server-authorized for authenticated administrator roles. This unauthenticated display is clearly marked as a preview.</p></article><article className="panel admin-panel"><div className="panel-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>Accountability log</h2></div><ClipboardCheck /></div><div className="governance-list">{(live?.audit ?? []).slice(0, 4).map(event => <div key={event.id}><strong>{event.action}</strong><span>{new Date(event.createdAt).toLocaleString()}</span></div>) || <p>No audit entries yet.</p>}</div><p className="access-note">Every simulator run, evidence upload, telemetry event, and review decision is written to the audit record.</p></article></section>}
        </>}

        {workspace === "defects" && <section className="workspace-page">
          <div className="workspace-header"><div><span className="eyebrow">FILTERABLE MAINTENANCE QUEUE</span><h2>Defect control</h2></div><div className="filter-row">{(["all", "critical", "high", "medium", "low"] as const).map(filter => <button key={filter} type="button" className={cn(severityFilter === filter && "active")} onClick={() => setSeverityFilter(filter)}>{filter}</button>)}</div></div>
          <div className="advanced-filters"><label>DEFECT TYPE<select value={defectTypeFilter} onChange={event => setDefectTypeFilter(event.target.value as typeof defectTypeFilter)}><option value="all">All types</option><option value="structural">Structural</option><option value="crack">Crack</option><option value="pothole">Pothole</option></select></label><label>STATUS<select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All states</option><option value="detected">Detected</option><option value="under_review">Under review</option><option value="verified">Verified</option><option value="scheduled">Scheduled</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label><label>REVIEW<select value={reviewFilter} onChange={event => setReviewFilter(event.target.value as typeof reviewFilter)}><option value="all">All reviews</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="overridden">Overridden</option><option value="rejected">Rejected</option></select></label><label>MISSION<select value={missionFilter} onChange={event => setMissionFilter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All missions</option>{availableMissions.map(mission => <option key={mission.id} value={mission.id}>{mission.name}</option>)}</select></label><label>ASSET<select value={assetFilter} onChange={event => setAssetFilter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">All assets</option>{availableAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label></div>
          <div className="defect-table"><div className="table-row table-head"><span>FINDING</span><span>MISSION</span><span>CONFIDENCE</span><span>PRIORITY</span><span>REVIEW</span></div>{visibleDefects.map(defect => <div key={defect.id} className="table-row"><div><strong>{defect.label}</strong><small>{defect.defectType} · {defect.latitude}, {defect.longitude}</small></div><span>DELHI / NC</span><span>{defect.confidencePercent}%</span><SeverityChip severity={defect.severity} />{!canOperate ? <span className="public-status">PUBLIC STATUS</span> : <div className="review-buttons"><button type="button" onClick={() => { setSelectedId(defect.id); submitReview("approve"); }}>APPROVE</button><button type="button" onClick={() => { setSelectedId(defect.id); submitReview("override"); }}>OVERRIDE</button></div>}</div>)}</div>
        </section>}

        {workspace === "evidence" && <section className="workspace-page evidence-workspace">
          <div className="workspace-header"><div><span className="eyebrow">SECURE MISSION MEDIA</span><h2>Evidence vault</h2></div><div><input ref={filePickerRef} className="file-picker" type="file" accept="image/*,video/*" onChange={event => handleEvidenceFile(event.target.files?.[0])} /><button type="button" className="primary-action" onClick={() => filePickerRef.current?.click()}><Upload /> {uploadEvidence.isPending ? "STORING" : "UPLOAD EVIDENCE"}</button></div></div>
          <div className="evidence-grid">{evidenceItems.length ? evidenceItems.map((item, index) => <article key={item.id} className="evidence-card"><div className={cn("evidence-thumb", `thumb-${index % 3}`)}>{item.mediaKind === "photo" || item.mediaKind === "annotation" ? <img src={item.storageUrl} alt={item.fileName} /> : null}{item.mediaKind === "video" && <video src={item.storageUrl} controls preload="metadata" />}<span>{String(index + 1).padStart(2, "0")}</span><div className="thumb-box" /></div><div><span className="severity-chip severity-low">{item.mediaKind}</span><h3>{item.fileName}</h3><p>Stored mission media · {item.latitude ?? "GPS pending"}, {item.longitude ?? ""}</p></div><a href={item.storageUrl} target="_blank" rel="noreferrer">OPEN {item.mediaKind === "annotation" ? "SIMULATED EVIDENCE" : "ORIGINAL"} <ChevronRight /></a></article>) : defects.map((defect, index) => <article key={defect.id} className="evidence-card"><div className={cn("evidence-thumb", `thumb-${index}`)}><span>{String(index + 1).padStart(2, "0")}</span><div className="thumb-box" /></div><div><SeverityChip severity={defect.severity} /><h3>{defect.label}</h3><p>Annotation locked to mission metadata · {defect.confidencePercent}% confidence.</p></div><button type="button" onClick={() => { setSelectedId(defect.id); setWorkspace("operations"); }}>OPEN REVIEW <ChevronRight /></button></article>)}</div>
        </section>}

        {workspace === "reports" && <section className="workspace-page">
          <div className="workspace-header"><div><span className="eyebrow">AUDIT-READY OUTPUTS</span><h2>Report records</h2></div><button type="button" className="primary-action" onClick={createAiBrief} disabled={decisionSupport.isPending}><Sparkles /> {decisionSupport.isPending ? "ANALYSING" : "GENERATE NARRATIVE"}</button></div>
          {aiBrief && <article className="ai-brief"><span className="eyebrow">AI DECISION-SUPPORT DRAFT · ENGINEER REVIEW REQUIRED</span><p>{aiBrief}</p></article>}
          <div className="report-stack">{reports.map(report => <article className="report-card" key={report.id}><div className="report-number">R/{String(report.id).padStart(3, "0")}</div><div><span className="eyebrow">{report.status}</span><h3>{report.title}</h3><p>{report.narrative}</p></div><div className="report-actions"><button type="button" onClick={() => auditAction("Report preview")}>PREVIEW</button>{report.storageUrl ? <a href={report.storageUrl} target="_blank" rel="noreferrer">DOWNLOAD</a> : <button type="button" onClick={() => auditAction("Report download pending storage")}>DOWNLOAD</button>}</div></article>)}</div>
        </section>}

        {workspace === "hardware" && <section className="workspace-page hardware-workspace">
          <div className="workspace-header"><div><span className="eyebrow">OPERATOR-CONTROLLED INTEGRATION</span><h2>Hardware bridge</h2></div><span className={cn("hardware-status", connectedStatus)}>{connectedStatus}</span></div>
          <div className="hardware-grid"><article className="hardware-card"><RadioTower /><span className="eyebrow">TELEMETRY INGRESS</span><h3>Compatible adapter contract</h3><p>Accept GPS, altitude, battery, speed, and timestamp data through an operator-approved HTTP or MAVLink bridge. Invalid payloads are rejected with clear validation feedback.</p><code>latitude · longitude · altitude · batteryPercent · timestamp</code></article><article className="hardware-card"><Video /><span className="eyebrow">MEDIA INGRESS</span><h3>Evidence-first capture</h3><p>Bring in camera images or clips via a compatible media bridge. The platform stores mission-linked originals and annotated outputs; it does not control aircraft cameras.</p><code>photo | video | annotation | report</code></article><article className="hardware-card"><ShieldCheck /><span className="eyebrow">SAFE FALLBACK</span><h3>Simulator remains available</h3><p>{hardware.data?.operatorMessage ?? "When hardware is offline, DRIFT stays fully usable in simulator mode without pretending to have a live connection."}</p><button type="button" onClick={() => runSimulator.mutate({ name: missionName })}>RUN SAFE DEMO <ChevronRight /></button></article></div>
        </section>}

        <footer className="console-footer"><span>DRIFT / ZEROERROR MAINTENANCE INTELLIGENCE</span><span>ENGINEER REVIEW REQUIRED FOR ALL AUTOMATED PRIORITIES</span></footer>
      </main>
    </div>
  );
}
