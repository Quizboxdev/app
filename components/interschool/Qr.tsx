import QRCode from "qrcode";

// A QR code drawn on the server as SVG, so it prints sharply on flyers and needs no script on the visitor's phone.
export default async function Qr({ value, size = 180, label }: { value: string; size?: number; label: string }) {
  const svg = await QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return <div role="img" aria-label={label} style={{ width: size, height: size, maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
