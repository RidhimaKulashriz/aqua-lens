import type { Metadata } from "next";

import { FadeIn } from "@/components/motion/fade-in";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Limitations",
  description:
    "AquaLens is an advisory tool. It does not certify water safety, detect toxins, or replace laboratory testing.",
  path: "/limitations",
});

const ITEMS = [
  {
    title: "Not certified.",
    body: "AquaLens does not produce certified water-quality results. Spectral indices are statistical proxies for water-quality parameters; certification requires accredited laboratory analysis.",
  },
  {
    title: "No toxin detection.",
    body: "AquaLens does not detect cyanotoxins, heavy metals, or pathogens. Bloom-related indices are precursor signals, not toxin measurements.",
  },
  {
    title: "Scene age and cloud cover.",
    body: "Sentinel-2 revisit time is 5 days at the equator and varies elsewhere. A high-cloud day means the latest usable scene may be a week or two old. Every report shows the capture date and cloud percentage.",
  },
  {
    title: "Mixed pixels.",
    body: "Indices computed over the water mask still mix shallow vegetation, sediment plumes, and shoreline in their tails. Treat individual pixels with skepticism; aggregate means are more robust.",
  },
  {
    title: "Field evidence required.",
    body: "Remote sensing never replaces field sampling. AquaLens prioritises where to sample. The final assessment still requires a wet-lab measurement.",
  },
  {
    title: "Advisory only.",
    body: "Every report carries an advisory disclaimer. Don't use AquaLens to make public-safety decisions on its own.",
  },
];

export default function LimitationsPage() {
  return (
    <article className="container max-w-3xl py-16 sm:py-20">
      <FadeIn>
        <p className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">
          Limitations
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">
          What AquaLens is not.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground leading-relaxed">
          We'd rather under-promise than over-claim. AquaLens is built to help field teams
          decide where to sample first — not to replace the chemistry that comes after.
        </p>
      </FadeIn>

      <div className="mt-12 space-y-4">
        {ITEMS.map((item) => (
          <FadeIn key={item.title}>
            <section className="rounded-md border border-border bg-card p-6 hover:border-aqua-500/30 transition-colors">
              <h2 className="font-display text-xl tracking-tight mb-2">{item.title}</h2>
              <p className="text-muted-foreground leading-relaxed">{item.body}</p>
            </section>
          </FadeIn>
        ))}
      </div>
    </article>
  );
}
