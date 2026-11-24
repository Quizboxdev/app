/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { RenderText } from "@/lib/policies/render";
import { flyerUrl, injectSubscribe, subscribeHref, type PostPublic } from "@/lib/posts/presentation";
import { withoutTitleLine } from "@/lib/help/categories";
import styles from "./PublicPost.module.css";

const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");

// The public page for a marketing post. Subscribe links are placed inside the article and a glossy Subscribe panel closes it; every one of them leads to the sign-up screen.
export default function PublicPost({ post }: { post: PostPublic }) {
  const href = subscribeHref(post.slug);
  const flyer = flyerUrl(post.flyer_path);
  const source = injectSubscribe(withoutTitleLine(post.body), href);
  return (
    <article className={`qbp-wrap ${styles.post}`} data-design="marketing-post">
      <nav aria-label="Breadcrumb" className={styles.crumb}><Link href="/">QuizBox</Link><span aria-hidden="true">/</span><span aria-current="page">News</span></nav>
      {flyer && <figure className={styles.flyer}><img src={flyer} alt={post.flyer_alt || post.title} /></figure>}
      <header className={styles.header}>
        <p className="qbp-eyebrow">QuizBox news</p>
        <h1>{post.title}</h1>
        {post.published_at && <p className={styles.meta}>{dateOf(post.published_at)}</p>}
        <p className={styles.lead}>{post.summary}</p>
      </header>
      <div className={`qbp-prose ${styles.body}`}><RenderText source={source} linkClass="qbp-link" normalizeHeadings /></div>
      <section className={styles.panel} aria-labelledby="post-subscribe">
        <h2 id="post-subscribe">Learn smarter with QuizBox</h2>
        <p>Practise the real school curriculum, see where you are strong and where to improve, and take on friends in challenges.</p>
        <ul className={styles.points}>
          <li>Questions matched to your class and subject</li>
          <li>Instant answers with clear explanations</li>
          <li>Progress you can share with teachers and parents</li>
        </ul>
        <div className={styles.actions}>
          <Link className={styles.cta} href={href}>Subscribe now</Link>
          <Link className={styles.signin} href="/login">Already have an account? Sign in</Link>
        </div>
      </section>
    </article>
  );
}
