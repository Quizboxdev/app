// Plain-language texts for the source fetch and supplied-file codes. Merged into lib/errors.ts without overriding existing texts.
export const SOURCE_MESSAGES: Record<string, string> = {
  SOURCE_HOST_UNREACHABLE: "The official site did not answer from the server. Try again later, or supply the PDF yourself.",
  FETCH_FAILED: "The file could not be fetched. Try again, or supply the PDF yourself.",
  PDF_NOT_FOUND: "The official site says that file does not exist at that address.",
  HOST_NOT_OFFICIAL: "The address is not on one of the authority's official domains.",
  NOT_A_PDF: "That file is not a PDF.",
  EXTRACTION_EMPTY: "The PDF has no readable text, so it cannot be used as a source.",
  SOURCE_TOO_LARGE: "The file is too large.",
  REQUEST_TOO_LARGE: "The file is larger than the 4 MB upload limit.",
  EMPTY_REQUEST: "No file was received.",
  SOURCE_STORAGE_FAILED: "The file could not be stored. Try again.",
};
