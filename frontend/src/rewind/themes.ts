// Rewind colour themes, one per slide (cycled).
// Replace these with your own gradients: `bg` is any CSS background, `glow` are the two
// floating light blobs, `accent` colours charts and highlights, `ink` is the text colour.
export interface Theme {
  bg: string
  glow: [string, string]
  accent: string
  ink: string
}

export const THEMES: Theme[] = [
  { bg: "linear-gradient(155deg, #ff6a3d 0%, #ff2d6f 48%, #6b21a8 100%)", glow: ["#ffd166", "#3a86ff"], accent: "#ffe08a", ink: "#ffffff" },
  { bg: "linear-gradient(200deg, #04261f 0%, #0f766e 52%, #a3e635 135%)", glow: ["#bef264", "#22d3ee"], accent: "#d9f99d", ink: "#ffffff" },
  { bg: "linear-gradient(165deg, #140f3a 0%, #4338ca 55%, #f472b6 125%)", glow: ["#f9a8d4", "#818cf8"], accent: "#fbcfe8", ink: "#ffffff" },
  { bg: "linear-gradient(150deg, #f59e0b 0%, #ef4444 58%, #7f1d1d 115%)", glow: ["#fde68a", "#fb7185"], accent: "#fef3c7", ink: "#ffffff" },
  { bg: "linear-gradient(190deg, #020617 0%, #1e3a8a 58%, #38bdf8 130%)", glow: ["#7dd3fc", "#c084fc"], accent: "#bae6fd", ink: "#ffffff" },
  { bg: "linear-gradient(160deg, #3b0764 0%, #9d174d 58%, #fb923c 122%)", glow: ["#fdba74", "#f0abfc"], accent: "#fed7aa", ink: "#ffffff" },
  { bg: "linear-gradient(170deg, #052e16 0%, #15803d 55%, #fde047 130%)", glow: ["#fef08a", "#86efac"], accent: "#fef9c3", ink: "#ffffff" },
]
