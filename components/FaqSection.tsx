import { Fragment } from "react";

/**
 * Visible rendering of a page's FAQ set.
 *
 * Every page that emits FAQPage JSON-LD must render the same questions and
 * answers on the visible page — structured data that describes invisible
 * content is a Google policy violation. Each page builds ONE faqs array and
 * feeds it to both faqNode() and this component, so the markup and the visible
 * text can never diverge.
 */
export function FaqSection({
  faqs,
}: {
  faqs: Array<{ question: string; answer: string }>;
}) {
  if (faqs.length === 0) return null;

  return (
    <section className="mt-14" aria-labelledby="faq">
      <h2
        id="faq"
        className="font-display text-2xl font-extrabold tracking-tight text-navy"
      >
        Common questions
      </h2>
      {faqs.map((faq) => (
        <Fragment key={faq.question}>
          <h3 className="mt-6 font-medium text-navy">{faq.question}</h3>
          <p className="prose-measure mt-2 leading-relaxed font-light text-navy">
            {faq.answer}
          </p>
        </Fragment>
      ))}
    </section>
  );
}
