/**
 * One @graph per page, rendered server-side into the HTML.
 *
 * Must stay in the static markup rather than being injected on the client —
 * most AI crawlers do not execute JavaScript, and this markup exists primarily
 * for them.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // Content is built from validated data, never user input. The escape
      // guards against a "</script>" sequence appearing inside review text.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
