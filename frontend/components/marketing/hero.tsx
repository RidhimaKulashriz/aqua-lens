"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export function Hero() {
  return (
    <section className="bg-paper text-ink selection:bg-signal/10 selection:text-signal">
      <div className="container mx-auto px-6 pt-16 pb-24 lg:pt-24 lg:pb-32">
        {/* Kicker */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="font-display italic text-muted text-lg lg:text-xl mb-6"
        >
          Field brief — water quality, remotely sensed
        </motion.p>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="font-display text-5xl lg:text-7xl leading-[1.05] tracking-tight max-w-[15ch] mb-12"
        >
          The water you can <span className="text-signal">actually monitor</span>.
        </motion.h1>

        {/* Two-column row */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-12 lg:gap-24 items-start mb-20">
          {/* Left Column: Lede + CTAs */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <p className="text-lg lg:text-xl leading-relaxed text-ink/90 max-w-[46ch] mb-10">
              AquaLens pulls recent Sentinel-2 imagery, computes six water-quality indices,
              fuses optional field evidence, and writes a grounded risk brief — so the field
              team knows where to sample first.
            </p>
            <div className="flex flex-wrap items-center gap-8">
              <Link
                href="/monitor"
                className="bg-ink text-paper px-8 py-3 font-medium hover:bg-ink/90 transition-colors"
              >
                Start monitoring
              </Link>
              <Link
                href="/methodology"
                className="text-ink font-medium underline underline-offset-4 hover:text-signal transition-colors"
              >
                View methodology
              </Link>
            </div>
          </motion.div>

          {/* Right Column: Report Card */}
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="border border-rule p-6 font-mono"
          >
            <div className="text-[10px] uppercase tracking-widest text-muted mb-6 border-b border-rule pb-2">
              SESSION_REPORT_SUMMARY
            </div>
            
            <div className="space-y-4 text-xs">
              <div className="flex justify-between border-b border-rule pb-2">
                <span className="text-muted">SESSION ID</span>
                <span className="text-ink">8599F3</span>
              </div>
              <div className="flex justify-between border-b border-rule pb-2">
                <span className="text-muted">COORDINATES</span>
                <span className="text-ink">49.239°N · 16.510°E</span>
              </div>
              <div className="flex justify-between border-b border-rule pb-2">
                <span className="text-muted">SCENE DATE</span>
                <span className="text-ink">2026-05-03</span>
              </div>
              <div className="flex justify-between border-b border-rule pb-2">
                <span className="text-muted">NDWI VALUE</span>
                <span className="text-signal font-bold">+0.46</span>
              </div>
              <div className="flex justify-between border-b border-rule pb-2">
                <span className="text-muted">TURBIDITY</span>
                <span className="text-ink">LOW</span>
              </div>
              <div className="flex justify-between border-b border-rule pb-2">
                <span className="text-muted">CHLOROPHYLL-A</span>
                <span className="text-flag font-bold">ELEVATED</span>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <div className="border border-flag text-flag px-3 py-1 text-[10px] font-bold tracking-widest rounded-full">
                FLAGGED FOR FIELD REVIEW
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Full-width strip */}
      <div className="border-t border-rule">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 lg:grid-cols-6 divide-y lg:divide-y-0 lg:divide-x divide-rule border-b lg:border-b-0 border-rule">
            <StatItem number="06" caption="spectral indices" />
            <StatItem number="10m" caption="resolution" />
            <StatItem number="~5d" caption="revisit" />
            <StatItem number="S2" caption="Sentinel-2" />
            <StatItem number="F-F" caption="field-fused evidence model" />
            <StatItem number="ADV" caption="advisory-not-a-lab-substitute" />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatItem({ number, caption }: { number: string; caption: string }) {
  return (
    <div className="flex flex-col gap-1 py-8 lg:px-4 lg:first:pl-0 lg:last:pr-0">
      <span className="font-display text-2xl text-ink">{number}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">{caption}</span>
    </div>
  );
}
