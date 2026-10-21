/* eslint-disable @next/next/no-img-element */
// A sponsor's logo. It is a small picture stored as data (see LogoPicker), so the Next image optimiser cannot help; a plain image is correct here.
export default function LogoImage({ src, alt = "", width, height, style }: { src: string; alt?: string; width?: number; height?: number; style?: React.CSSProperties }) {
  return <img src={src} alt={alt} width={width} height={height} style={style} />;
}
