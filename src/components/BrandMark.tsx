/**
 * The Mononmani Welding Works mark: an "M" drawn as one continuous weld bead on an arc-orange
 * tile, with a few sparks thrown off the last stroke. Plain geometry so it stays crisp at any size.
 */
export default function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} role="img" aria-label="Mononmani Welding Works">
      <rect width="36" height="36" rx="8" fill="var(--color-arc-500)" />
      <path
        d="M9 26V11l9 10 9-10v15"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M29.5 7.5l1.7-2.1M32 11.5h2.2M26 4.8l.5-2.3"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.85"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
