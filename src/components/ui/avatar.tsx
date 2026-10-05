/** Initials in a tinted circle. The tint is derived from the name so it stays the same for the same person. */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}
function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 997;
  return (h % 6) + 1;
}

/**
 * Pass `decorative` when the person's name is already written next to the avatar;
 * otherwise it is exposed as an image named after them.
 */
export function Avatar({ name, size = "md", decorative }: { name: string; size?: "sm" | "md" | "lg"; decorative?: boolean }) {
  return (
    <span className="avatar" data-size={size === "md" ? undefined : size} data-hue={hue(name)} {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })}>
      {initials(name)}
    </span>
  );
}
