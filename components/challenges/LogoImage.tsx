/* eslint-disable @next/next/no-img-element */
// New uploads are compact objects in the public sponsor-branding bucket. Keep rendering historic data URLs during migration.
export default function LogoImage({ src, alt = "", width, height, style }: { src: string; alt?: string; width?: number; height?: number; style?: React.CSSProperties }) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const resolved = src.startsWith("campaigns/") && base
    ? `${base}/storage/v1/object/public/sponsor-branding/${src.split("/").map(encodeURIComponent).join("/")}`
    : src;
  return <img src={resolved} alt={alt} width={width} height={height} style={style} />;
}
