// Decides what the "Install QuizBox" card should show. Pure, so it can be tested without a browser.
export type InstallEnv = { standalone: boolean; userAgent: string; hasPrompt: boolean; dismissedAt: number | null; now: number };
export type InstallState = "installed" | "prompt" | "ios" | "hidden";
export const DISMISS_DAYS = 30;

export function installState(env: InstallEnv): InstallState {
  if (env.standalone) return "installed";
  if (env.dismissedAt && env.now - env.dismissedAt < DISMISS_DAYS * 864e5) return "hidden";
  if (env.hasPrompt) return "prompt";
  const ua = env.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);       // only Safari on iPhone can add to the home screen
  return ios ? "ios" : "hidden";
}
