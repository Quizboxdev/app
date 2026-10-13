import file from "../../config/public-visibility.json";

// Which sections of the public home page visitors see, from config/public-visibility.json. Unknown or missing keys default to visible so a
// typo never blanks the page; only an explicit false hides a section.
export type PublicSection = keyof typeof file.home_sections;
export const showPublic = (section: string, config: { home_sections?: Record<string, unknown> } = file): boolean =>
  config.home_sections?.[section] !== false;
