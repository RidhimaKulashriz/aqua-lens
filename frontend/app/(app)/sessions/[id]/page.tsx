"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, FileText, Mountain, Plus } from "lucide-react";

import { EvidenceList } from "@/components/evidence/evidence-list";
import { FadeIn } from "@/components/motion/fade-in";
import { DownloadReportButton } from "@/components/report/download-button";
import { AOIBanner, AOITypeBadge } from "@/components/session/aoi-banner";
import { AgentTraceCard } from "@/components/session/agent-trace";
import { AnalysisSummaryCard } from "@/components/session/analysis-summary-card";
import { IndexGrid } from "@/components/session/index-grid";
import { IndexTable } from "@/components/session/index-table";
import { ProcessingSkeleton } from "@/components/session/processing-skeleton";
import { RiskCard } from "@/components/session/risk-card";
import { SceneMetadata } from "@/components/session/scene-metadata";
import { StatusPill } from "@/components/session/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSession } from "@/hooks/use-sessions";
import type { RiskLevel } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { formatLocationLabel, pointToLatLng } from "@/lib/location";

const MiniMap = dynamic(() => import("@/components/map/mini-map").then((m) => m.MiniMap), {
  ssr: false,
});

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, isLoading, isError } = useSession(id, { polling: true });

  if (isLoading || !data) {
    return (
      <div className="container max-w-6xl py-8 sm:py-10">
        <ProcessingSkeleton status="processing" message="Loading session" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container max-w-6xl py-8 sm:py-10">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Couldn't load this session. Try refreshing the page.
          </CardContent>
        </Card>
      </div>
    );
  }

  const stillRunning = data.status === "processing" || data.status === "pending";
  const isFailed = data.status === "failed";
  const hasIndices = data.indices.length > 0;
  const aoiIsWater = !data.aoi_type || data.aoi_type === "water";
  const centroid = pointToLatLng(data.water_body.centroid);
  const locationLabel = formatLocationLabel({
    name: data.water_body.name,
    lat: centroid?.lat ?? null,
    lng: centroid?.lng ?? null,
    digits: 3,
  });

  return (
    <div className="container max-w-7xl py-8 sm:py-10">
      <FadeIn>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link
              href="/sessions"
              className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3" /> Sessions
            </Link>
            <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">
              {locationLabel}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Updated {formatRelative(data.updated_at)} ·{" "}
              <span className="font-mono">{data.id}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={data.status} />
            <AOITypeBadge aoiType={data.aoi_type} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/sessions/${data.id}/evidence`}>
                <Plus className="size-3.5" /> Add evidence
              </Link>
            </Button>
            {data.report_id ? (
              <DownloadReportButton sessionId={data.id} className="h-9 px-3 text-xs" />
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/sessions/${data.id}/report`}>
                <FileText className="size-3.5" /> Open report
              </Link>
            </Button>
          </div>
        </header>
      </FadeIn>

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-6">
          {stillRunning ? (
            <ProcessingSkeleton
              status={data.status}
              message={data.status_message}
              sessionId={data.id}
              aoiType={data.aoi_type}
              waterFraction={data.water_fraction}
            />
          ) : (
            <>
              {isFailed ? (
                <FadeIn>
                  <FailureNotice message={data.status_message} />
                </FadeIn>
              ) : null}
              {data.aoi_type && data.aoi_type !== "water" ? (
                <FadeIn>
                  <AOIBanner aoiType={data.aoi_type} waterFraction={data.water_fraction} />
                </FadeIn>
              ) : null}
              <FadeIn>
                <SceneMetadata session={data} />
              </FadeIn>
              {hasIndices ? (
                <>
                  <FadeIn>
                    <IndexGrid indices={data.indices} />
                  </FadeIn>
                  <FadeIn>
                    <IndexTable indices={data.indices} />
                  </FadeIn>
                </>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-sm text-muted-foreground">
                    No indices were stored before the pipeline failed.
                  </CardContent>
                </Card>
              )}
              {data.risk ? (
                <FadeIn>
                  <RiskCard risk={data.risk} />
                </FadeIn>
              ) : null}
              {data.citizen_summary ? (
                <FadeIn>
                  <AnalysisSummaryCard summary={data.citizen_summary} />
                </FadeIn>
              ) : null}
              {aoiIsWater ? (
                <FadeIn>
                  <AgentTraceCard sessionId={data.id} sessionStatus={data.status} />
                </FadeIn>
              ) : (
                <FadeIn>
                  <NoAgentLayerNotice />
                </FadeIn>
              )}
              <FadeIn>
                <EvidenceList items={data.evidence} />
              </FadeIn>
            </>
          )}
        </section>
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <FadeIn>
            <Card>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                    Area of interest
                  </p>
                  {!aoiIsWater ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-2xs font-medium text-amber-300">
                      <Mountain className="size-3" aria-hidden /> Not water
                    </span>
                  ) : null}
                </div>
                <MiniMap polygon={data.water_body.geometry} />
              </CardContent>
            </Card>
          </FadeIn>
          {!stillRunning && data.risk ? (
            <FadeIn>
              <Card>
                <CardContent className="space-y-3 p-5">
                  <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
                    Key metrics
                  </p>
                  <TintedMetric
                    label="Risk score"
                    value={`${(data.risk.score * 100).toFixed(0)} / 100`}
                    level={data.risk.level}
                    emphasis
                  />
                  <TintedMetric
                    label="Level"
                    value={data.risk.level}
                    level={data.risk.level}
                  />
                  <TintedMetric
                    label="Urgency"
                    value={data.risk.urgency}
                    level={data.risk.level}
                    subtle
                  />
                  <Metric
                    label="Capture date"
                    value={formatRelative(data.scene_capture_date ?? data.created_at)}
                  />
                  <Metric
                    label="Cloud cover"
                    value={`${data.scene_cloud_cover?.toFixed(0) ?? 0}%`}
                  />
                </CardContent>
              </Card>
            </FadeIn>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function FailureNotice({ message }: { message: string | null }) {
  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardContent className="flex items-start gap-3 p-5">
        <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Session failed</p>
          <p className="text-sm text-muted-foreground">{message || "An unknown error occurred."}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function NoAgentLayerNotice() {
  return (
    <Card className="border-amber-500/35 bg-amber-500/10">
      <CardContent className="p-5">
        <p className="text-sm text-foreground">
          This AOI was classified as non-water, so the agentic workflow was skipped for this run.
        </p>
      </CardContent>
    </Card>
  );
}

function TintedMetric({
  label,
  value,
  level,
  emphasis = false,
  subtle = false,
}: {
  label: string;
  value: string;
  level: RiskLevel;
  emphasis?: boolean;
  subtle?: boolean;
}) {
  const color =
    level === "high"
      ? "text-risk-high-fg dark:text-risk-high"
      : level === "medium"
        ? "text-risk-medium-fg dark:text-risk-medium"
        : "text-risk-low-fg dark:text-risk-low";
  const bg =
    level === "high"
      ? "bg-risk-high/10"
      : level === "medium"
        ? "bg-risk-medium/10"
        : "bg-risk-low/10";

  return (
    <div className={cn("flex items-center justify-between rounded-sm px-3 py-2", bg, emphasis ? "font-medium" : "")}>
      <span className={cn("text-sm", subtle ? "text-muted-foreground" : "text-foreground")}>{label}</span>
      <span className={cn("font-mono text-sm", color)}>{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-sm border border-border bg-surface-1 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  );
}
