import type { Metadata } from "next";

import { FadeIn } from "@/components/motion/fade-in";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Methodology",
  description:
    "Two linked pipelines: a deterministic numeric core, then a five-agent Gemini layer that writes the brief and the citizen summary.",
  path: "/methodology",
});

const INDICES = [
  {
    key: "NDWI",
    name: "Normalized Difference Water Index",
    formula: "(NIR − SWIR) / (NIR + SWIR)",
    bands: "B08 · B11",
    interpretation: "Open-water signal. Values above zero indicate water cover.",
  },
  {
    key: "MNDWI",
    name: "Modified NDWI",
    formula: "(Green − SWIR) / (Green + SWIR)",
    bands: "B03 · B11",
    interpretation: "Water signal that holds up in urban / built-up settings.",
  },
  {
    key: "NDTI",
    name: "Normalized Difference Turbidity",
    formula: "(Red − Green) / (Red + Green)",
    bands: "B04 · B03",
    interpretation: "Higher values indicate more turbid water columns.",
  },
  {
    key: "NDCI",
    name: "Normalized Difference Chlorophyll",
    formula: "(RedEdge − Red) / (RedEdge + Red)",
    bands: "B05 · B04",
    interpretation: "Proxy for chlorophyll-a, a bloom precursor.",
  },
  {
    key: "NDVI",
    name: "Normalized Difference Vegetation",
    formula: "(NIR − Red) / (NIR + Red)",
    bands: "B08 · B04",
    interpretation: "Shoreline vegetation health; useful as a stress co-signal.",
  },
  {
    key: "WRI",
    name: "Water Ratio Index",
    formula: "(Green + Red) / (NIR + SWIR)",
    bands: "B03 · B04 · B08 · B11",
    interpretation: "Strong open-water signature when values exceed 2.5.",
  },
];

const RISK_WEIGHTS = [
  { name: "NDCI (chlorophyll proxy)", w: "0.40" },
  { name: "NDTI (turbidity)", w: "0.25" },
  { name: "NDVI shoreline stress", w: "0.10" },
  { name: "MNDWI water-signal floor", w: "0.10" },
  { name: "NDWI water-signal floor", w: "0.15" },
];

export default function MethodologyPage() {
  return (
    <article className="container max-w-3xl py-16 sm:py-20">
      <FadeIn>
        <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          Methodology
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">
          How AquaLens reads water from space.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground leading-relaxed">
          AquaLens runs two linked pipelines. The deterministic numeric core
          pulls a fresh Sentinel-2 scene, computes six band-math indices over
          the water mask, and produces a 0–100 risk score that is unit-tested
          and never moved by the LLM. The Gemini agent layer wraps that core
          with five specialist agents that choose inputs, gather grounded
          context, write the brief, and publish a citizen-facing summary.
          Every step is reproducible and recorded.
        </p>
      </FadeIn>

      <FadeIn>
        <section className="mt-14 space-y-6">
          <h2 className="font-display text-2xl tracking-tight">Imagery acquisition</h2>
          <p className="text-muted-foreground leading-relaxed">
            We query the Microsoft Planetary Computer STAC API for the
            <code className="mx-1 rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs">sentinel-2-l2a</code>
            collection, intersected with the polygon and filtered by
            <code className="mx-1 rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs">eo:cloud_cover &lt; threshold</code>.
            The most recent matching scene is selected, the asset URLs are signed, and the
            relevant bands (B02 · B03 · B04 · B05 · B08 · B11) are streamed as Cloud-Optimized
            GeoTIFFs and clipped to the AOI.
          </p>
        </section>
      </FadeIn>

      <FadeIn>
        <section className="mt-14 space-y-6">
          <h2 className="font-display text-2xl tracking-tight">Spectral indices</h2>
          <p className="text-muted-foreground leading-relaxed">
            Each index is a pure numpy function over the band stack. We mask non-water
            pixels using NDWI &gt; 0, then aggregate to a masked-mean per index.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {INDICES.map((idx) => (
              <Card key={idx.key} className="hover:border-aqua-500/30 transition-colors">
                <CardHeader className="gap-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{idx.name}</CardTitle>
                    <Badge variant="aqua">{idx.key}</Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    bands · {idx.bands}
                  </p>
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-sm">{idx.formula}</p>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {idx.interpretation}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </FadeIn>

      <FadeIn>
        <section className="mt-14 space-y-6">
          <h2 className="font-display text-2xl tracking-tight">Risk model</h2>
          <p className="text-muted-foreground leading-relaxed">
            The numeric score is deterministic and audit-friendly. Each contributing
            factor is normalized into{" "}
            <code className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs">[0, 1]</code>{" "}
            and multiplied by its weight. Field-evidence flags then add a bonus up to{" "}
            <code className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs">0.5</code>,
            and the result is clamped.
          </p>
          <div className="rounded-md border border-border bg-card p-5">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Weights
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RISK_WEIGHTS.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between rounded-xs border border-border bg-surface-1 px-3 py-2 text-sm"
                >
                  <dt>{row.name}</dt>
                  <dd className="font-mono text-muted-foreground">{row.w}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Levels bucket at{" "}
            <code className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs">&lt; 0.33</code>{" "}
            (low) and{" "}
            <code className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-xs">&lt; 0.66</code>{" "}
            (medium); the rest is high. Urgency is a function of the level plus severity of
            the latest evidence (algae presence, dead-fish count, complaints).
          </p>
        </section>
      </FadeIn>

      <FadeIn>
        <section className="mt-14 space-y-6">
          <h2 className="font-display text-2xl tracking-tight">Agentic hand-over</h2>
          <p className="text-muted-foreground leading-relaxed">
            Once deterministic scoring is complete, the runtime hands the
            session bundle to the agent layer. Agents can pick inputs,
            gather context, and write prose, but they cannot override the
            deterministic level or urgency. Each agent is a focused Gemini
            call constrained by a domain-specific system prompt and a
            structured-output contract that forbids overclaiming.
          </p>
        </section>
      </FadeIn>

      <FadeIn>
        <section className="mt-14 space-y-6">
          <h2 className="font-display text-2xl tracking-tight">Multi-agent workflow</h2>
          <p className="text-muted-foreground leading-relaxed">
            When a session runs, a small graph of specialised Gemini agents
            plans the work, gathers context, drafts the brief, and turns it
            into a citizen-facing summary. Agent colour and action-label
            wording match the in-app Agentic workflow card so the marketing
            surface and the live trace describe exactly the same thing.
          </p>

          <ol className="space-y-3">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-aqua-500/10 text-aqua-600 text-xs font-mono font-medium">1</span>
              <div>
                <p className="font-medium text-foreground">Coordinator</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Plans the workflow and delegates to specialist agents. Adapts based on water-body history.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 text-xs font-mono font-medium">2</span>
              <div>
                <p className="font-medium text-foreground">Scout</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Uses multimodal vision on the real Sentinel-2 RGB thumbnail. Re-queries STAC with tighter cloud bounds when haze is detected.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-xs font-mono font-medium">3</span>
              <div>
                <p className="font-medium text-foreground">Historian</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Combines Google Search grounding, URL Context, code execution (Mann-Kendall trend significance) and long-context history into a single briefing.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-600 text-xs font-mono font-medium">4</span>
              <div>
                <p className="font-medium text-foreground">Analyst</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Drafts the narrative, runs a self-critique pass against the hard rules, and rewrites once when the critique rejects the draft.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-mono font-medium">5</span>
              <div>
                <p className="font-medium text-foreground">Reporter</p>
                <p className="text-sm text-muted-foreground leading-relaxed">Turns the multi-agent outputs into a structured citizen summary card (tone, guidance, limitations, and citations).</p>
              </div>
            </li>
          </ol>
        </section>
      </FadeIn>
    </article>
  );
}
