import { describe, expect, it } from "vitest";
import { authConfigMeetsPolicy, isEasyToGuess, PASSWORD_MIN_LENGTH, PASSWORD_TOO_EASY, PASSWORD_TOO_SHORT, passwordProblem, suggestPassphrase } from "./password-policy";

describe("learner password policy", () => {
  it("accepts short, memorable passwords a young learner can manage", () => {
    for (const ok of ["mango cat", "blue mango river", "kofi2015", "Ama-lion", "star99"]) expect(passwordProblem(ok)).toBeNull();
  });
  it("rejects too-short passwords and the ones guessed first, with child-friendly advice", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(6);
    expect(passwordProblem("cat12")).toBe(PASSWORD_TOO_SHORT);
    for (const easy of ["123456", "12345678", "654321", "000000", "aaaaaa", "abcdef", "password", "Password1", "qwerty", "ghana123", "QuizBox123", "iloveyou"])
      expect(passwordProblem(easy), easy).toBe(PASSWORD_TOO_EASY);
    expect(isEasyToGuess("mango-river-47")).toBe(false);
  });
  it("suggests two different words and a two-digit number that pass the policy", () => {
    let i = 0; const seq = [0, 0, 1, 37];
    expect(suggestPassphrase((max) => seq[i++] % max)).toBe("mango-river-47");
    for (let n = 0; n < 200; n++) { const s = suggestPassphrase(); expect(s).toMatch(/^[a-z]+-[a-z]+-[1-9][0-9]$/); expect(passwordProblem(s)).toBeNull(); }
  });
  it("matches a live Auth configuration of at least the policy minimum, with or without leaked-password protection", () => {
    expect(authConfigMeetsPolicy({ password_min_length: 6, password_hibp_enabled: false })).toEqual({ met: true, mode: "APP_COMMON_PASSWORD_CHECK" });
    expect(authConfigMeetsPolicy({ password_min_length: 8, password_hibp_enabled: true })).toEqual({ met: true, mode: "LEAKED_PASSWORD_PROTECTION" });
    expect(authConfigMeetsPolicy({ password_min_length: null }).met).toBe(false);
  });
});
