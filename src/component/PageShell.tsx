import type { ReactNode } from "react";

import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-10 pt-16">
      <p className="text-[11px] uppercase tracking-[0.3em] text-primary">{eyebrow}</p>
      <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-foreground md:text-5xl">
        {title}
      </h1>
      {description && (
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
