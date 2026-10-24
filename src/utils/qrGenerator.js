import QRCode from "qrcode";

export async function renderQueueQr(target, storeIdOrUrl, options = {}) {
  if (!target) {
    throw new Error("A canvas target is required to render a QR code.");
  }

  const rawValue = String(storeIdOrUrl || "").trim();
  const value = rawValue.startsWith("http")
    ? rawValue
    : `${window.location.origin}/q?store=${rawValue}`;

  await QRCode.toCanvas(target, value, {
    width: 180,
    margin: 1,
    ...options,
  });

  return value;
}
