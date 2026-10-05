import { createClient } from "@supabase/supabase-js";
import { applyLocalEnvironmentSafely, loadAcceptanceEnvironment } from "../lib/operations/acceptance";
import { assertNotProduction } from "../lib/operations/safety";
// Acceptance accounts only. The admin key and the new password come from the environment, never from this file.
loadAcceptanceEnvironment(); applyLocalEnvironmentSafely(); assertNotProduction(process.env);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const newPassword = process.env.QB_ACCEPTANCE_PASSWORD;
if (!key || !newPassword) throw new Error("SERVER_ADMIN_KEY_AND_ACCEPTANCE_PASSWORD_REQUIRED");
const client = createClient(url, key, { auth: { persistSession: false } });

async function reset() {
  const emails = [
    "admin.test@quizbox.local",
    "student.test@quizbox.local",
    "student2.test@quizbox.local",
    "teacher.test@quizbox.local",
    "sponsor.test@quizbox.local",
    "seller.test@quizbox.local"
  ];
  const { data: { users }, error } = await client.auth.admin.listUsers();
  if (error) throw error;
  
  for (const email of emails) {
    const user = users.find(u => u.email === email);
    if (user) {
      const { error: updateError } = await client.auth.admin.updateUserById(user.id, { password: newPassword });
      if (updateError) {
        console.error("Failed to update " + email + ": " + updateError.message);
      } else {
        console.log("Updated password for " + email);
      }
    } else {
      console.error("User not found: " + email);
    }
  }
}

reset().catch(console.error);
