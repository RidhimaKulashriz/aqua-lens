import Link from "next/link";

import { Logo } from "@/components/chrome/logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/monitor", label: "Start a session" },
      { href: "/dashboard", label: "Open the app" },
      { href: "/methodology", label: "Methodology" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: "/about", label: "About" },
      { href: "/limitations", label: "Limitations" },
      { href: "https://github.com/RidhimaKulashriz1/aqualens", label: "GitHub" },
    ],
  },
  {
    title: "Data",
    links: [
      { href: "https://element84.com/earth-search/", label: "AWS Earth Search (Sentinel-2)" },
      { href: "https://openfreemap.org", label: "OpenFreeMap" },
      { href: "https://maplibre.org", label: "MapLibre" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface-1">
      <div className="container spacious-y px-6">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_3fr]">
          <div className="space-y-4">
            <Logo />
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              AquaLens is an autonomous freshwater monitoring agent. It produces advisory
              risk indicators, not certified water-safety results.
            </p>
            <p className="font-mono text-2xs uppercase tracking-widest text-muted-foreground/70">
              © {new Date().getFullYear()} RidhimaKulashriz · MIT License
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title} className="space-y-4">
                <h4 className="text-2xs font-semibold uppercase tracking-widest text-foreground/60">
                  {col.title}
                </h4>
                <ul className="space-y-2.5 text-sm">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-foreground/75 transition-colors duration-200 hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="rule-double mt-12">
          <p className="pt-6 text-xs leading-relaxed text-muted-foreground">
            Sentinel-2 imagery © European Union, contains modified Copernicus Sentinel data
            accessed via AWS Earth Search. Base map © OpenStreetMap contributors, ODbL 1.0.
          </p>
        </div>
      </div>
    </footer>
  );
}
