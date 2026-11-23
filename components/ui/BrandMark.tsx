/**
 * The Atlantis mark: a black tile with the triangle. Black in light mode,
 * inverted in dark mode so it doesn't vanish into the background.
 */
export default function BrandMark({ size = 32 }: { size?: number }) {
  const glyph = Math.round(size * 0.44);
  return (
    <span
      className="brand-mark rounded-xl flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 2L14 13H2L8 2Z" fill="currentColor" fillOpacity="0.9" />
      </svg>
    </span>
  );
}
