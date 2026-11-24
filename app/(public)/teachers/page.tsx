import type { Metadata } from "next";
import AudiencePage from "@/components/public/AudiencePage";
import { PUBLIC_LINKS } from "@/components/public/links";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "For teachers | QuizBox",
  description: "Assign curriculum-linked questions from approved banks, let automatic marking do the scoring, and see class mastery and weak indicators.",
  alternates: { canonical: `${SITE_URL}/teachers` },
  openGraph: { type: "website", siteName: "QuizBox", url: `${SITE_URL}/teachers`, title: "QuizBox for teachers", description: "Assign from approved question banks and see who needs support." },
};
export const revalidate = 300;

export default function TeachersPage() {
  return (
    <AudiencePage id="teachers" color="#0f7a30" eyebrow="For teachers"
      title={<>Assign in minutes. <span className="qbp-accent">See who needs support.</span></>}
      lead="Set work from reviewed, curriculum-linked questions, let automatic marking do the scoring, and use class mastery to decide what to teach next."
      primary={{ label: "Create a teacher account", href: PUBLIC_LINKS.registerTeacher }} secondary={{ label: "Bring QuizBox to your school", href: "/schools" }}
      note={<>Subject experts can also <a className="qbp-link" href={PUBLIC_LINKS.sme}>apply to review questions</a>.</>}
      benefitsTitle="What teachers get"
      benefits={[
        { title: "Approved question banks", text: "Set assignments from reviewed, curriculum-linked questions." },
        { title: "Automatic marking", text: "Answers are marked as learners submit, so results are ready when you are." },
        { title: "Class mastery", text: "Classes, assignments and a gradebook in one workspace." },
        { title: "Targeted support", text: "Weak indicators are highlighted for each class, plus competitions your class is eligible for." },
      ]}
      stepsTitle="How it starts"
      steps={[
        { title: "1 · Create your account", text: "Sign up as a teacher. Subject experts can choose the reviewer option while signing up." },
        { title: "2 · Set up your class", text: "Create a class and add your learners." },
        { title: "3 · Assign practice", text: "Choose a subject and topic from the approved banks and set it for the class." },
        { title: "4 · Follow the results", text: "See class mastery and the indicators where learners need support, then plan your next lesson." },
      ]}
      faq="teachers"
      closing={{ title: "Start with one class.", text: "Free to start. Add more classes whenever you are ready." }} />
  );
}
