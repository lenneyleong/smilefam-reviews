import Link from "next/link";

/**
 * Brand-styled 404. The links mirror the places a lost visitor most likely
 * meant to reach — a mistyped review URL should land one click from the
 * archive, not on a dead end.
 */

const RECOVERY_LINKS = [
  { href: "/", label: "Home" },
  { href: "/reviews", label: "Browse all reviews" },
  { href: "/is-smilefam-legit", label: "Is SmileFam legit?" },
  { href: "/reviews/critical", label: "Read the critical reviews" },
] as const;

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-14 sm:py-20">
      <p className="wordmark text-sm">SmileFam</p>

      <h1 className="mt-6 max-w-[18ch] font-display text-4xl leading-[1.08] font-extrabold tracking-tight text-navy sm:text-5xl">
        This page doesn&rsquo;t <span className="text-glow">exist</span>.
      </h1>

      <p className="prose-measure mt-6 text-lg leading-relaxed font-light text-navy">
        The address may have been mistyped, or the page may have moved.
        Everything on this site is reachable from these four places:
      </p>

      <ul className="mt-8 flex flex-col gap-3">
        {RECOVERY_LINKS.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              className="font-medium text-navy underline decoration-silver decoration-1 underline-offset-4 transition-colors hover:decoration-navy"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
