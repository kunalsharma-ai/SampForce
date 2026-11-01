/** Wraps each occurrence of the search words in <mark>, so matches stand out in results. Case-insensitive. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-warning/25 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}
