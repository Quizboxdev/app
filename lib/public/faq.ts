// Questions people ask before they sign up, answered only with what the product and its sources support.
// Used by the home page, the parents page and the FAQ structured data. Nothing here may state a figure (data use, hours saved, share of syllabus covered)
// unless it is measured and recorded; see lib/public/faq.test.ts, which fails when a number slips in.
export type Faq = { id: string; q: string; a: string; where: ("home" | "parents")[] };

export const FAQS: Faq[] = [
  { id: "syllabus", where: ["home", "parents"], q: "How do we know the questions match the real syllabus?",
    a: "Questions are built from the curriculum documents approved by GES and NaCCA, and each one is linked to a curriculum indicator. A subject expert reviews questions before learners see them." },
  { id: "install", where: ["home", "parents"], q: "Do we need to install an app?",
    a: "No. QuizBox runs in the browser on a phone, tablet or computer. Sign in and start." },
  { id: "shared-phone", where: ["home", "parents"], q: "Can my child use my phone?",
    a: "Yes. Any phone or tablet with a browser will do. Your child signs in to their own account, so their results stay theirs. Children under 13 have extra protection and do not pay online." },
  { id: "cost", where: ["home", "parents"], q: "What does it cost to start?",
    a: "Starting is free: everyone gets free sessions when they sign up. Plans and Coins are listed on the Pricing page and can be bought for one child or several children in one checkout." },
  { id: "coverage", where: ["home", "parents"], q: "Which classes and subjects are covered?",
    a: "Primary (Basic 4 to 6), JHS and SHS, starting in Ghana. The subjects open for each class are shown when you choose your class, and more are added as they pass review." },
  { id: "prizes", where: ["home"], q: "How do sponsor prizes reach students?",
    a: "Each challenge sets out its recognition and is approved before it is published. Prizes are provided by the sponsor and depend on the competition, so the challenge page shows what is on offer." },
  { id: "privacy", where: ["parents"], q: "Who can see my child's results?",
    a: "You only see the children linked to your family. Removing a child ends your link only: their account, school and results stay the same." },
  { id: "set-work", where: ["parents"], q: "Can I set work for my children?",
    a: "Yes. From your family space you can give approved practice, share question sets you have bought and invite children to challenges you choose." },
];

export const faqsFor = (where: "home" | "parents") => FAQS.filter((f) => f.where.includes(where));

// Structured data so search results can show the questions. Built from the same list, so it can never drift from the page.
export const faqJsonLd = (items: Faq[]) => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});
