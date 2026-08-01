"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/chrome/logo";
import { ThemeToggle } from "@/components/chrome/theme-toggle";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/methodology", label: "Methodology" },
  { href: "/limitations", label: "Limitations" },
  { href: "/changelog", label: "Changelog" },
  { href: "/about", label: "About" },
];

export function TopNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b border-transparent transition-[background,backdrop-filter,border-color,box-shadow] duration-300",
        scrolled && "glass border-border shadow-elev-1",
      )}
    >
      <div className="container flex h-16 items-center justify-between gap-8 px-6">
        <Link href="/" aria-label="AquaLens home" className="flex-shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-2 min-[901px]:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative rounded-sm px-4 py-2 text-sm font-medium transition-colors duration-200 hover:text-foreground",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80",
                )}
              >
                {link.label}
                {active ? (
                  <span className="absolute inset-x-4 -bottom-1 h-0.5 bg-foreground" />
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild size="sm" variant="outline" className="hidden min-[901px]:inline-flex">
            <Link href="/dashboard">Open app</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/monitor">Start monitoring</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
