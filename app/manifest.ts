import type { MetadataRoute } from "next";

// Web app manifest (completion plan, Phase 4 step 2): lets learners and teachers add QuizBox to their phone's home screen and open it full screen.
// A service worker (public/sw.js) keeps static files and shows an offline page; pages themselves always come from the network, and there is no offline answering.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QuizBox: Learn. Practise. Compete.",
    short_name: "QuizBox",
    description: "Curriculum practice, assignments and competitions for Ghanaian learners and teachers.",
    start_url: "/student",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    categories: ["education"],
    icons: [
      { src: "/brand/quizbox-icon-96.png", sizes: "96x96", type: "image/png" },
      { src: "/brand/quizbox-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/quizbox-app-icon.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/quizbox-app-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
