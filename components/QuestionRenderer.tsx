"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import katex from "katex";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AttemptQuestion, ContentBlock } from "@/lib/types";

function MathFragment({
  latex,
  display = "block",
}: {
  latex: string;
  display?: "inline" | "block";
}) {
  const html = useMemo(
    () =>
      katex.renderToString(latex, {
        throwOnError: false,
        displayMode: display === "block",
      }),
    [latex, display]
  );

  return (
    <span
      className="qb-math"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function AssetImage({
  assetId,
  alt,
  media,
}: {
  assetId: string;
  alt?: string;
  media?: AttemptQuestion["media"];
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const match = (media ?? []).find(
        (m) => m.media_asset_id === assetId
      );
      if (!match?.storage_bucket || !match?.storage_path) return;

      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.storage
        .from(match.storage_bucket)
        .createSignedUrl(match.storage_path, 3600);

      if (!cancelled && !error) {
        setUrl(data.signedUrl);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [assetId, media]);

  if (!url) {
    return <div className="qb-muted qb-small">Loading image…</div>;
  }

  return <Image className="qb-question-image" src={url} alt={alt ?? ""} width={960} height={540} unoptimized />;
}

function Blocks({
  blocks,
  media,
}: {
  blocks?: ContentBlock[];
  media?: AttemptQuestion["media"];
}) {
  if (!blocks?.length) return null;

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "text") {
          return <p key={index}>{block.text}</p>;
        }

        if (block.type === "math") {
          return (
            <div key={index}>
              <MathFragment latex={block.latex} display={block.display} />
            </div>
          );
        }

        if (block.type === "image") {
          return (
            <AssetImage
              key={index}
              assetId={block.asset_id}
              alt={block.alt}
              media={media}
            />
          );
        }

        return null;
      })}
    </>
  );
}

export function RichContent({
  content,
  media,
  fallback,
}: {
  content?: { blocks?: ContentBlock[] } | null;
  media?: AttemptQuestion["media"];
  fallback?: string | null;
}) {
  if (content?.blocks?.length) {
    return <Blocks blocks={content.blocks} media={media} />;
  }

  return fallback ? <p>{fallback}</p> : null;
}

export default function QuestionRenderer({
  question,
}: {
  question: AttemptQuestion;
}) {
  return (
    <div className="qb-question-text">
      <RichContent
        content={question.question_content}
        media={question.media}
        fallback={question.question_text}
      />
    </div>
  );
}
