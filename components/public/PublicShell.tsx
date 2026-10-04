import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

export default function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="qbp-skip">Skip to content</a>
      <PublicHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicFooter />
    </>
  );
}
