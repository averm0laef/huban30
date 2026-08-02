/**
 * Emits a Schema.org payload.
 *
 * The value is produced by the helpers in `_lib/seo`, which already escape
 * angle brackets so the serialised JSON cannot close the surrounding tag.
 */
export function JsonLd({ value }: { value: string }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: value }} />
  );
}
