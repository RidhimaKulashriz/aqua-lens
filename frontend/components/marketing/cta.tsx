"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section className="container py-20 sm:py-24">
      <FadeIn>
        <div className="relative isolate overflow-hidden rounded-lg border-2 border-border bg-card panel-inset">
          <div className="grid items-center gap-10 p-10 sm:gap-12 sm:grid-cols-[2fr_1fr] sm:p-14">
            <div>
              <p className="font-mono text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                Ready when you are
              </p>
              <h2 className="mt-4 max-w-xl font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Point AquaLens at any lake on Earth and watch the pipeline run.
              </h2>
              <p className="mt-5 max-w-xl text-balance leading-relaxed text-muted-foreground">
                Drawing the polygon takes ten seconds. The first scene, indices, and risk
                brief land less than a minute later — no account required.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 sm:justify-end">
              <Button asChild size="lg">
                <Link href="/monitor" className="group">
                  Start monitoring
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/dashboard">Open dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </FadeIn>
    </section>
  );
}
