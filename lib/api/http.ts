// Reads a JSON API response. A crashed, timed-out or oversized request is answered by the platform with an HTML page, not
// JSON; report that as a readable message with the HTTP status instead of "Unexpected token '<' … is not valid JSON".
export async function readJson<T = Record<string, unknown>>(response: Response, service: string): Promise<T & { error?: string }> {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch {
    const reason = response.status === 413 ? "the upload is too large" : response.status === 504 ? "the request timed out" : `HTTP ${response.status}`;
    throw new Error(`The ${service} service could not complete the request (${reason}). Try again in a minute; if it persists, contact support.`);
  }
}
