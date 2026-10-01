export type UserRole = "STUDENT" | "TEACHER" | "ADMIN" | "OWNER" | "SUPPORT" | "SPONSOR" | string;

export interface UserContext {
  userId: string;
  role: UserRole;
  profile: Record<string, unknown>;
  studentProfile?: Record<string, unknown> | null;
  teacherProfile?: Record<string, unknown> | null;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "math"; latex: string; display?: "inline" | "block" }
  | { type: "image"; asset_id: string; alt?: string; caption?: string };

export interface AttemptQuestion {
  question_order?: number | null;
  question_id: string;
  question_text?: string | null;
  question_content?: { blocks?: ContentBlock[] } | null;
  answer_type?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  option_d?: string | null;
  options?: Array<{
    option_key: string;
    display_order?: number;
    content?: { blocks?: ContentBlock[] };
  }> | null;
  media?: Array<{
    media_asset_id?: string;
    storage_bucket?: string;
    storage_path?: string;
    media_type?: string;
    mime_type?: string;
    alt_text?: string;
    caption?: string;
  }> | null;
  marks?: number | null;
}

export interface AttemptPayload {
  status: string;
  attempt_id: string;
  assessment_id: string;
  attempt_status: string;
  started_at: string;
  expires_at?: string | null;
  server_time?: string;
  remaining_seconds?: number;
  questions: AttemptQuestion[];
  saved_responses?: Array<{
    question_id: string;
    selected_answer?: string | null;
    selected_value?: unknown;
    answered_at?: string | null;
  }>;
}
