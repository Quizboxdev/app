// Password policy for a user base of learners aged 8–18 (docs/security/password-policy.md).
// Supabase enforces a 6-character minimum with no character-class rules, and leaked-password protection is deliberately off,
// so the app refuses the short list of passwords anyone would try first and offers an easy passphrase instead.
export const PASSWORD_MIN_LENGTH = 6;

export const PASSWORD_TOO_SHORT = `Use at least ${PASSWORD_MIN_LENGTH} characters. Two short words work well, like "mango cat".`;
export const PASSWORD_TOO_EASY = `That password is too easy to guess. Try two or three words together, like "blue mango river".`;

const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssword", "qwerty", "qwerty1", "qwerty123", "qwertyuiop",
  "azerty", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm", "1q2w3e", "1q2w3e4r", "q1w2e3r4", "abc123", "abcd1234", "abcdef", "abcdefg",
  "iloveyou", "iloveu", "letmein", "welcome", "welcome1", "monkey", "dragon", "football", "soccer", "princess", "sunshine",
  "secret", "admin", "admin123", "login", "student", "teacher", "school", "myschool", "ghana", "ghana123", "accra", "kumasi",
  "blackstars", "quizbox", "quizbox1", "quizbox123", "123123", "121212", "112233", "123321", "147258", "159753", "696969", "131313",
]);

const isRun = (s: string, alphabet: string) => alphabet.includes(s) || [...alphabet].reverse().join("").includes(s);

// True for passwords on the common list, one repeated character (aaaaaa, 000000) or a straight run (123456, 654321, abcdef).
export function isEasyToGuess(password: string): boolean {
  const p = password.toLowerCase().replace(/\s+/g, "");
  return COMMON.has(p) || /^(.)\1+$/.test(p) || isRun(p, "01234567890") || isRun(p, "abcdefghijklmnopqrstuvwxyz");
}

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_TOO_SHORT;
  if (isEasyToGuess(password)) return PASSWORD_TOO_EASY;
  return null;
}

// Short, familiar words a young learner can spell and remember.
const WORDS = ["mango", "river", "lion", "cocoa", "drum", "star", "kente", "banana", "rain", "sun", "moon", "eagle", "tiger", "pepper",
  "orange", "green", "blue", "yellow", "purple", "happy", "brave", "quick", "jolly", "tall", "zebra", "turtle", "parrot", "cloud",
  "ocean", "forest", "rocket", "pencil", "garden", "palm", "coconut", "puppy", "kitten", "bread", "honey", "maize"];

// Two words and a two-digit number, e.g. "green-mango-47". Uses the browser's cryptographic random source.
export function suggestPassphrase(random: (max: number) => number = (max) => crypto.getRandomValues(new Uint32Array(1))[0] % max): string {
  const first = WORDS[random(WORDS.length)];
  let second = WORDS[random(WORDS.length)];
  while (second === first) second = WORDS[random(WORDS.length)];
  return `${first}-${second}-${String(10 + random(90))}`;
}

// Release gate: the live Supabase Auth configuration matches this policy when it enforces at least PASSWORD_MIN_LENGTH characters.
// Leaked-password protection is then optional: with it off, the app-side isEasyToGuess() check is the documented compensating
// control (accepted 2026-10-09 for the 8–18 user base).
export function authConfigMeetsPolicy(config: { password_hibp_enabled?: boolean; password_min_length?: number | null }) {
  const minimum = Number(config.password_min_length ?? 0) >= PASSWORD_MIN_LENGTH;
  return { met: minimum, mode: config.password_hibp_enabled === true ? "LEAKED_PASSWORD_PROTECTION" : "APP_COMMON_PASSWORD_CHECK" } as const;
}
