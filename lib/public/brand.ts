// QuizBox brand architecture.
//
// Primary horizontal identity: [QUIZBOX MARK] QUIZBOX / "Learning • Assessment • Competition Platform".
// QuizBox is multi-level and multi-market, so the brand descriptor never names an education level
// (e.g. "JHS") or a country. Level/curriculum terms belong in product and curriculum copy only.
//
// Marketing taglines ("Learn • Practice • Compete", "Learn it. Practice it. Challenge someone.") are
// UI/marketing copy and are not part of the logo lockup.
//
// The neon mark (public/brand/quizbox-icon-96.png, quizbox-app-icon.png, quizbox-apple-icon.png,
// quizbox-mark.webp) is the symbol in the lockup and the favicon / PWA / app icon / splash artwork.
// Small icons never carry the descriptor.

export const BRAND_NAME = "QuizBox";
export const BRAND_DESCRIPTOR_FULL = "Learning • Assessment • Competition Platform";
export const BRAND_DESCRIPTOR_SHORT = "Learning • Assessment • Competition";
export const MARKETING_TAGLINE = "Learn • Practice • Compete";

export type LockupVariant = "full" | "compact" | "mark" | "responsive";

export const BRAND_ICON = { src: "/brand/quizbox-icon-96.png", width: 96, height: 96 } as const;
