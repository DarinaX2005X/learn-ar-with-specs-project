/** Native assets are optional so a newly opened project remains runnable. */
export interface MuseumFonts { regular?: Font; bold?: Font; }
export function applyMuseumFont(text: Text, fonts: MuseumFonts | undefined,
  weight: "regular" | "bold"): void {
  const font = weight === "bold" ? fonts?.bold ?? fonts?.regular : fonts?.regular ?? fonts?.bold;
  if (font) text.font = font;
}
