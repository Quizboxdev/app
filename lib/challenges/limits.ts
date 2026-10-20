// Limits on material, shown to the organiser before they upload and enforced again on the server and in the database.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_PASSAGES = 400;          // about 300 printed pages of text
export const MAX_DOCUMENTS = 5;           // per quiz
export const MAX_PASTED_CHARS = 600_000;
export const LOGO_MAX_PIXELS = 160;
export const LOGO_MAX_CHARS = 45_000;
export const LIMITS_TEXT = `PDF, Word (.docx) or text, up to 8 MB (about 300 pages of text) and 5 documents per quiz. Pages that are only pictures of text will not work: they need to be typed or run through text recognition first.`;
