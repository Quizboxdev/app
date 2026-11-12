// QuizBox's official channels: the one list the footer, the contact page, the app menu and the student home all read.
// Addresses come from the internship brief (Digital Marketing Practicum 01). Change one here and every place follows.
export type SocialId = "tiktok" | "instagram" | "facebook" | "youtube" | "linkedin" | "snapchat";

export type SocialChannel = { id: SocialId; name: string; handle: string; href: string; verb: string };

export const SOCIAL_CHANNELS: readonly SocialChannel[] = [
  { id: "tiktok", name: "TikTok", handle: "@quizz_box", href: "https://www.tiktok.com/@quizz_box", verb: "Follow" },
  { id: "instagram", name: "Instagram", handle: "@quizz.box.solutions", href: "https://www.instagram.com/quizz.box.solutions/", verb: "Follow" },
  { id: "facebook", name: "Facebook", handle: "quizbox.solutions", href: "https://www.facebook.com/quizbox.solutions/", verb: "Like" },
  { id: "youtube", name: "YouTube", handle: "@QuizBoxsolutions", href: "https://www.youtube.com/@QuizBoxsolutions", verb: "Subscribe" },
  { id: "linkedin", name: "LinkedIn", handle: "QuizBox Solutions", href: "https://www.linkedin.com/company/94181986", verb: "Follow" },
  // The brief gives only the Snapchat username ("quizbox"); Snapchat's add-friend address is built from it.
  { id: "snapchat", name: "Snapchat", handle: "quizbox", href: "https://www.snapchat.com/add/quizbox", verb: "Add" },
] as const;

export const SHARE_TEXT = "I practise for school on QuizBox: curriculum questions, challenges and competitions. Sign up free:";

// The links behind the share buttons. `url` is the page being shared (the visitor's own site, so Preview shares Preview).
export function shareLinks(url: string, text: string = SHARE_TEXT) {
  const enc = encodeURIComponent, both = `${text} ${url}`;
  return {
    whatsapp: `https://wa.me/?text=${enc(both)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
    telegram: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
    message: both,
  };
}
