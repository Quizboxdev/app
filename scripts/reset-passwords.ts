import { createClient } from "@supabase/supabase-js";
const url = "https://fngdtxayfoiffbcbmcum.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuZ2R0eGF5Zm9pZmZiY2JtY3VtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDk3NDQ3OSwiZXhwIjoyMTA2NTUwNDc5fQ.mI1w8boAABjoOJ6C7LRzWOKk3UPSWfrFxJ2z_hYokoA";
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
      const { error: updateError } = await client.auth.admin.updateUserById(user.id, { password: "Quixbox123!" });
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
