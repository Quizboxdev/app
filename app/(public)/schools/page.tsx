import type { Metadata } from "next";
import AudiencePage from "@/components/public/AudiencePage";
import { PUBLIC_LINKS } from "@/components/public/links";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "For schools | QuizBox",
  description: "Bring teachers and classes onto one platform with reviewed, curriculum-linked content, and follow participation and performance across the school.",
  alternates: { canonical: `${SITE_URL}/schools` },
  openGraph: { type: "website", siteName: "QuizBox", url: `${SITE_URL}/schools`, title: "QuizBox for schools", description: "Teachers and classes under one school profile." },
};
export const revalidate = 300;

export default function SchoolsPage() {
  return (
    <AudiencePage id="schools" color="#00758c" eyebrow="For schools & organisations"
      title={<>One platform for your teachers, classes and <span className="qbp-accent">school teams.</span></>}
      lead="Bring teachers and classes together with reviewed, curriculum-linked content, keep assessment consistent, and follow participation and performance across the school."
      primary={{ label: "Register school interest", href: PUBLIC_LINKS.school }} secondary={{ label: "Teachers can start now", href: "/teachers" }}
      note="Institutional access is set up by QuizBox after review. Registering interest is not approval."
      benefitsTitle="What schools get"
      benefits={[
        { title: "One school profile", text: "Teachers and classes sit under one school profile." },
        { title: "Reviewed content for every class", text: "Questions are built from the approved curriculum and reviewed by subject experts before use." },
        { title: "Participation and performance", text: "See how classes take part and perform across the school." },
        { title: "School teams in competitions", text: "Prepare teams for the competitions your school is eligible for." },
      ]}
      stepsTitle="How a school gets started"
      steps={[
        { title: "1 · Register interest", text: "Tell us about your school and what you would like to do with QuizBox." },
        { title: "2 · QuizBox reviews", text: "We review the request and set up institutional access." },
        { title: "3 · Teachers and classes join", text: "Teachers create their accounts and classes under the school profile." },
        { title: "4 · Follow the picture", text: "See participation and performance across classes and prepare school teams." },
      ]}
      faq="schools"
      closing={{ title: "Tell us about your school.", text: "Registering interest takes a few minutes and does not commit you to anything." }} />
  );
}
