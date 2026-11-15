// Cloudflare Turnstile (captcha) for sign-in, sign-up and password reset. It is OFF until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set in Vercel, so deploying this code changes nothing by itself.
// Turn it on in this order: deploy with the site key set, THEN enable captcha in Supabase (Authentication, Attack Protection) with the secret key. Supabase refuses sign-ins that carry no token once it is on.
export const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const captchaEnabled = (siteKey: string | undefined) => typeof siteKey === "string" && siteKey.trim() !== "";

// The option Supabase Auth expects; an empty object when there is no token (captcha off), so existing calls are unchanged.
export const captchaOptions = (token: string | null | undefined): { captchaToken?: string } => (token ? { captchaToken: token } : {});

export const CAPTCHA_WAIT_MESSAGE = "Wait for the security check to finish, then try again.";
export const CAPTCHA_FAILED_MESSAGE = "The security check could not load. Refresh the page, or try another browser, and try again.";
