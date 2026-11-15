import { toBlob } from "html-to-image"

export const SHARE_SIZES = {
  story: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
} as const
export type ShareFormat = keyof typeof SHARE_SIZES

/** Render a DOM node to PNG and hand it to the system share sheet (or download it). */
export async function shareNode(node: HTMLElement, fileName: string, title: string) {
  // let images inside the off-screen card finish loading
  await Promise.all(
    [...node.querySelectorAll("img")].map((img) =>
      img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(null) }),
    ),
  )
  await document.fonts.ready
  const blob = await toBlob(node, { pixelRatio: 1, cacheBust: false })
  if (!blob) throw new Error("Bild konnte nicht erzeugt werden")
  const file = new File([blob], fileName, { type: "image/png" })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return "shared"
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled"
    }
  }
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return "downloaded"
}

export async function shareLink(url: string, title: string) {
  if (navigator.share) {
    try {
      await navigator.share({ url, title })
      return "shared"
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled"
    }
  }
  await navigator.clipboard.writeText(url)
  return "copied"
}
