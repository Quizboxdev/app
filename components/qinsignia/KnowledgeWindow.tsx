"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import SubjectIcon from "@/components/SubjectIcon";
import { BRAND_ICON } from "@/lib/public/brand";
import { subjectHue } from "@/lib/brand/subjects";
import { subjectPhoto } from "@/lib/brand/subject-photography";
import type { SubjectCardView } from "@/lib/learning/subject-card-state";
import { useWorkspaceFlags } from "@/components/WorkspaceProvider";

// Q-Insignia Knowledge Window (v0.2): the subject photo card. It is presentation only — every word, number and action comes from
// the caller (which reads the existing practice menu, access, attempt and mastery data) through a SubjectCardView.
//   discovery  8:5 photo card (square photo in the 2-column mobile grid), whole card is one link
//   compact    horizontal strip with a square thumbnail, whole card is one link (Progress, Teacher subject lists)
//   progress   discovery layout with a measure slot (MasteryBadge etc.) under the title
//   returning  wide strip for an unfinished attempt with its stored progress
//   selector   a toggle button (aria-pressed) used where a subject is chosen inside a builder; never navigates
// The photo is independent of the data: no approved photo, or a photo that fails to load, shows the subject letter tile
// (PHOTO_UNAVAILABLE) and changes nothing else. The official Q mark is the shipped PNG, never redrawn.
export type KnowledgeWindowVariant = "discovery" | "compact" | "progress" | "returning" | "selector";

type Common = {
  name: string;
  displayName?: string;     // what to print when it differs from the lookup name (e.g. a sanitised curriculum title)
  variant?: KnowledgeWindowVariant;
  meta?: ReactNode;
  view: SubjectCardView;
  measure?: ReactNode;
  headingLevel?: 2 | 3 | 4;
};
type AsLink = Common & { href: string; selected?: never; onSelect?: never };
type AsToggle = Common & { href?: never; selected: boolean; onSelect: () => void };
export type KnowledgeWindowProps = AsLink | AsToggle;

// Existing .qb-pill tones only (no new status colours): info is the default blue pill.
const TONE: Record<SubjectCardView["tone"], string> = { info: "", success: "success", warning: "warning", review: "amber", neutral: "neutral", danger: "danger" };

export function KnowledgeWindowArt({ name, square, view, small }: { name: string; square?: boolean; view?: SubjectCardView; small?: boolean }) {
  const flags = useWorkspaceFlags();
  const photo = subjectPhoto(name, { allowConcept: flags.q_insignia_concept_photos });
  const [broken, setBroken] = useState(false);
  const shown = photo && !broken ? photo : null;
  const hue = subjectHue(name);
  const progress = view?.progress;
  return <div className={`qi-kw-art${shown ? " has-photo" : ""}${square ? " is-square" : ""}`} data-photo={shown ? "ready" : "unavailable"}
    style={shown ? undefined : { background: `linear-gradient(135deg, hsl(${hue} 55% 30%), hsl(${hue} 60% 18%))` }}>
    {shown ? <picture>
      {!square && <source media="(max-width: 760px)" type="image/webp" srcSet={shown.mobileImage.webp} />}
      <source type="image/webp" srcSet={square ? shown.mobileImage.webp : shown.discoveryImage.webp} />
      {/* <img> inside <picture> on purpose: static, pre-sized assets; next/image would re-encode the approved files. */}
      <img className="qi-kw-photo" src={square ? shown.mobileImage.jpg : shown.discoveryImage.jpg} alt="" loading="lazy" decoding="async"
        width={square ? 640 : 960} height={square ? 640 : 600} style={{ objectPosition: shown.focalPoint }} onError={() => setBroken(true)} />
    </picture> : <span className="qi-kw-glyph" aria-hidden="true"><SubjectIcon name={name} size={small ? 30 : 44} /></span>}
    <span className="qi-kw-corner" aria-hidden="true" />
    <span className="qi-kw-q" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BRAND_ICON.src} alt="" width={BRAND_ICON.width} height={BRAND_ICON.height} loading="lazy" decoding="async" />
    </span>
    {progress != null && <span className="qi-kw-prog" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>}
  </div>;
}

export default function KnowledgeWindow(props: KnowledgeWindowProps) {
  const { name, displayName, variant = "discovery", meta, view, measure, headingLevel = 3 } = props;
  const title = displayName ?? name;
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const strip = variant === "compact" || variant === "returning";
  const off = view.state === "CONTENT_UNAVAILABLE";
  const isToggle = "onSelect" in props && typeof props.onSelect === "function";
  const cls = `qi-kw qi-kw-${variant}${strip ? " qi-kw-strip" : ""}${off ? " is-off" : ""}${view.state === "ACCESS_REQUIRED" ? " is-locked" : ""}${isToggle && props.selected ? " is-selected" : ""}`;
  const pill = view.status ? <span className={`qb-pill ${TONE[view.tone]}`.trim()}>{view.status}</span> : null;
  const action = isToggle
    ? <span className="qi-kw-action">{props.selected ? <><Check size={14} aria-hidden="true" /> Selected</> : "Choose"}</span>
    : view.action.kind !== "none" ? <span className="qi-kw-action">{view.action.label} <ArrowRight size={14} aria-hidden="true" /></span> : null;
  const progressText = view.progress != null ? <span className="qb-sr-only">{`${view.progress}% of this attempt answered.`}</span> : null;

  const inner = <>
    <KnowledgeWindowArt name={name} square={strip} view={view} small={variant === "compact"} />
    <span className="qi-kw-body">
      {isToggle ? <span className="qi-kw-title">{title}</span> : <H className="qi-kw-title">{title}</H>}
      {meta && <span className="qi-kw-meta">{meta}</span>}
      {measure && <span className="qi-kw-measure">{measure}</span>}
      {(pill || action) && <span className="qi-kw-foot">{pill}{action}</span>}
      {progressText}
    </span>
  </>;

  if (isToggle) {
    return <button type="button" className={cls} aria-pressed={props.selected} disabled={off} onClick={props.onSelect} data-state={view.state}>{inner}</button>;
  }
  if (off || view.state === "LOADING") return <div className={cls} data-state={view.state} aria-busy={view.state === "LOADING" || undefined}>{inner}</div>;
  return <Link className={cls} href={(props as AsLink).href} data-state={view.state}>{inner}</Link>;
}

export function KnowledgeWindowGrid({ children, label, dense }: { children: ReactNode; label?: string; dense?: boolean }) {
  return <div className={`qi-kw-grid${dense ? " is-dense" : ""}`} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}
