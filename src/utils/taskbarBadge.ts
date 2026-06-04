import { getCurrentWindow } from "@tauri-apps/api/window";

const ICON_SIZE = 64;
const MAX_DISPLAY_COUNT = 99;
const iconCache = new Map<string, Uint8Array>();

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to render taskbar badge icon"));
        return;
      }

      blob.arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

async function createBadgeIcon(count: number): Promise<Uint8Array> {
  const displayCount = count > MAX_DISPLAY_COUNT ? `${MAX_DISPLAY_COUNT}+` : String(count);
  const cached = iconCache.get(displayCount);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas is unavailable for taskbar badge rendering");
  }

  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  ctx.beginPath();
  ctx.arc(ICON_SIZE / 2, ICON_SIZE / 2, 29, 0, Math.PI * 2);
  ctx.fillStyle = "#2563eb";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${displayCount.length >= 3 ? 22 : displayCount.length === 2 ? 28 : 36}px Segoe UI, Arial, sans-serif`;
  ctx.fillText(displayCount, ICON_SIZE / 2, ICON_SIZE / 2 + 1);

  const icon = await canvasToPngBytes(canvas);
  iconCache.set(displayCount, icon);
  return icon;
}

export async function syncTaskbarUnreadBadge(
  count: number,
  log?: (message: string) => void
): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    if (count <= 0) {
      await appWindow.setOverlayIcon(undefined);
      return;
    }

    await appWindow.setOverlayIcon(await createBadgeIcon(count));
  } catch (error) {
    log?.(`Failed to sync taskbar unread badge: ${error}`);
  }
}
