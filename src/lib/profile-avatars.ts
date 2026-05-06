export type ProfileAvatarPreset = {
  id: string
  label: string
  src: string
}

type FaceRecipe = {
  expression: string
  hair: string
  detail: string
}

const INK = "#1f2937"
const MUTED = "#e5e7eb"
const PAPER = "#ffffff"
const WASH = "#f8fafc"

const expressions = [
  "차분한",
  "밝은",
  "집중한",
  "생각하는",
  "호기심 있는",
  "단정한",
  "상냥한",
  "침착한",
  "장난기 있는",
  "자신감 있는",
]

const hairLabels = [
  "짧은 머리",
  "단발",
  "긴 앞머리",
  "웨이브",
  "가르마",
  "묶은 머리",
  "둥근 머리",
  "곱슬",
  "깔끔한 앞머리",
  "볼륨 머리",
]

const detailLabels = [
  "기본",
  "둥근 안경",
  "사각 안경",
  "주근깨",
  "볼점",
  "볼터치",
  "헤어핀",
  "헤드밴드",
  "한쪽 눈썹",
  "작은 귀걸이",
]

const faceShapes = [
  '<path d="M36 63c0-23 11-37 28-37s28 14 28 37c0 25-12 39-28 39S36 88 36 63Z" fill="#ffffff" stroke="#1f2937" stroke-width="3"/>',
  '<path d="M34 62c0-22 12-36 30-36s30 14 30 36c0 23-13 38-30 38S34 85 34 62Z" fill="#ffffff" stroke="#1f2937" stroke-width="3"/>',
  '<path d="M38 60c0-22 10-34 26-34s26 12 26 34c0 28-10 43-26 43S38 88 38 60Z" fill="#ffffff" stroke="#1f2937" stroke-width="3"/>',
  '<path d="M35 64c0-25 11-38 29-38s29 13 29 38c0 24-12 36-29 36S35 88 35 64Z" fill="#ffffff" stroke="#1f2937" stroke-width="3"/>',
  '<path d="M36 61c3-23 14-35 31-34 17 1 27 15 25 38-3 24-16 37-33 35-17-2-26-16-23-39Z" fill="#ffffff" stroke="#1f2937" stroke-width="3"/>',
]

const hairShapes = [
  '<path d="M35 58c2-23 13-35 29-35s27 11 30 34c-9-7-18-10-28-10-11 0-21 4-31 11Z" fill="#1f2937"/>',
  '<path d="M33 61c0-25 12-40 31-40s31 15 31 40c-10-9-20-13-31-13S43 52 33 61Z" fill="#1f2937"/>',
  '<path d="M37 57c-2-18 9-34 27-36 18-1 30 10 32 29-13 1-22-7-32-7-10 0-17 7-27 14Z" fill="#1f2937"/>',
  '<path d="M34 59c3-23 14-36 31-37 16-1 29 8 34 27-12 0-20 3-28 8-11 6-23 7-37 2Z" fill="#1f2937"/>',
  '<path d="M35 57c5-22 16-33 32-32 17 1 27 12 29 34-10-5-18-5-27-2-11 4-22 4-34 0Z" fill="#1f2937"/>',
  '<path d="M38 54c4-20 15-31 32-31 15 0 25 8 30 24-9-3-16-2-23 2-12 7-24 9-39 5Z" fill="#1f2937"/><circle cx="96" cy="40" r="10" fill="#1f2937"/>',
  '<path d="M34 59c2-22 13-35 31-35 19 0 31 13 32 36-13-6-23-8-32-8-10 0-20 2-31 7Z" fill="#1f2937"/><path d="M48 30c13-6 26-6 39 0" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".7"/>',
  '<path d="M31 61c3-26 15-39 34-39 18 0 30 12 34 36-8-3-14-2-21 2-15 8-29 9-47 1Z" fill="#1f2937"/><g fill="#ffffff" opacity=".35"><circle cx="46" cy="43" r="2"/><circle cx="57" cy="37" r="2"/><circle cx="72" cy="39" r="2"/><circle cx="84" cy="47" r="2"/></g>',
  '<path d="M35 57c2-22 13-34 30-34 18 0 29 12 31 35-15-2-25-9-31-18-8 11-18 16-30 17Z" fill="#1f2937"/>',
  '<path d="M33 61c2-25 13-38 31-38 19 0 32 14 34 39-10-7-20-10-31-9-12 1-23 4-34 8Z" fill="#1f2937"/><path d="M44 48c9-7 19-10 31-8" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".75"/>',
]

const eyeShapes = [
  '<g fill="#1f2937"><circle cx="54" cy="66" r="2.8"/><circle cx="76" cy="66" r="2.8"/></g>',
  '<g fill="none" stroke="#1f2937" stroke-width="2.6" stroke-linecap="round"><path d="M50 66c3-3 7-3 10 0"/><path d="M72 66c3-3 7-3 10 0"/></g>',
  '<g fill="#1f2937"><ellipse cx="54" cy="66" rx="2.4" ry="3.4"/><ellipse cx="76" cy="66" rx="2.4" ry="3.4"/></g>',
  '<g fill="none" stroke="#1f2937" stroke-width="2.6" stroke-linecap="round"><path d="M50 65h9"/><path d="M72 65h9"/></g>',
  '<g fill="#1f2937"><circle cx="54" cy="65" r="2.7"/><path d="M73 66c4-4 8-4 12 0" fill="none" stroke="#1f2937" stroke-width="2.6" stroke-linecap="round"/></g>',
]

const browShapes = [
  '<g fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round" opacity=".78"><path d="M48 58c4-2 8-2 12 0"/><path d="M70 58c4-2 8-2 12 0"/></g>',
  '<g fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round" opacity=".78"><path d="M48 58l11-2"/><path d="M71 56l11 2"/></g>',
  '<g fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round" opacity=".78"><path d="M48 57l11 2"/><path d="M71 59l11-2"/></g>',
  '<g fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round" opacity=".78"><path d="M49 57h10"/><path d="M72 57h10"/></g>',
  '<g fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round" opacity=".78"><path d="M48 56c4 3 8 3 12 0"/><path d="M70 56c4 3 8 3 12 0"/></g>',
]

const noseShapes = [
  '<path d="M64 66c-3 5-3 9 2 11" fill="none" stroke="#1f2937" stroke-width="2.4" stroke-linecap="round"/>',
  '<path d="M65 65v12h5" fill="none" stroke="#1f2937" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M66 66c2 5 1 9-3 11" fill="none" stroke="#1f2937" stroke-width="2.4" stroke-linecap="round"/>',
  '<path d="M65 66c-1 5 0 8 4 10" fill="none" stroke="#1f2937" stroke-width="2.4" stroke-linecap="round"/>',
  '<circle cx="66" cy="75" r="1.7" fill="#1f2937"/>',
]

const mouthShapes = [
  '<path d="M56 83c5 4 12 4 17 0" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M57 83h16" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M56 81c4 7 14 7 18 0" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>',
  '<circle cx="65" cy="83" r="2.6" fill="#1f2937"/>',
  '<path d="M56 82c2 4 6 6 10 6s8-2 10-6" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/>',
]

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function getRecipe(index: number): FaceRecipe {
  return {
    expression: expressions[index % expressions.length],
    hair: hairLabels[(index * 3 + Math.floor(index / 4)) % hairLabels.length],
    detail: detailLabels[(index * 7 + Math.floor(index / 5)) % detailLabels.length],
  }
}

function renderFaceDetail(index: number) {
  switch (index % 10) {
    case 1:
      return '<g fill="none" stroke="#1f2937" stroke-width="2.4"><circle cx="54" cy="66" r="8"/><circle cx="76" cy="66" r="8"/><path d="M62 66h6"/></g>'
    case 2:
      return '<g fill="none" stroke="#1f2937" stroke-width="2.4"><rect x="46" y="59" width="16" height="12" rx="4"/><rect x="68" y="59" width="16" height="12" rx="4"/><path d="M62 65h6"/></g>'
    case 3:
      return '<g fill="#1f2937" opacity=".42"><circle cx="49" cy="75" r="1.1"/><circle cx="55" cy="77" r="1.1"/><circle cx="75" cy="77" r="1.1"/><circle cx="81" cy="75" r="1.1"/></g>'
    case 4:
      return '<circle cx="82" cy="77" r="1.7" fill="#1f2937" opacity=".62"/>'
    case 5:
      return '<g fill="#e5e7eb"><ellipse cx="48" cy="76" rx="5" ry="3"/><ellipse cx="82" cy="76" rx="5" ry="3"/></g>'
    case 6:
      return '<path d="M40 46l12-7 3 10" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    case 7:
      return '<path d="M35 51c17-15 42-17 59-4" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity=".88"/>'
    case 8:
      return '<path d="M71 55c5-5 11-5 16 0" fill="none" stroke="#1f2937" stroke-width="2.5" stroke-linecap="round"/>'
    case 9:
      return '<g fill="none" stroke="#1f2937" stroke-width="2"><circle cx="38" cy="69" r="3"/><circle cx="91" cy="69" r="3"/></g>'
    default:
      return ""
  }
}

function renderFaceAvatar(index: number) {
  const tilt = index % 2 === 0 ? -2 : 2
  const face = faceShapes[index % faceShapes.length]
  const hair = hairShapes[(index * 3) % hairShapes.length]
  const eyes = eyeShapes[(index * 7) % eyeShapes.length]
  const brows = browShapes[(index * 5 + Math.floor(index / 6)) % browShapes.length]
  const nose = noseShapes[(index * 2 + Math.floor(index / 5)) % noseShapes.length]
  const mouth = mouthShapes[(index * 3 + Math.floor(index / 3)) % mouthShapes.length]
  const detail = renderFaceDetail(index)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <desc>notion-face-${String(index + 1).padStart(2, "0")}</desc>
    <rect width="128" height="128" rx="28" fill="${PAPER}"/>
    <path d="M25 103c12 8 27 12 44 11 16-1 29-7 38-18" fill="none" stroke="${MUTED}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="25" cy="32" r="8" fill="${WASH}" stroke="${MUTED}" stroke-width="2"/>
    <g transform="rotate(${tilt} 64 64)">
      <ellipse cx="36" cy="67" rx="5" ry="8" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>
      <ellipse cx="92" cy="67" rx="5" ry="8" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>
      ${face}
      ${hair}
      ${brows}
      ${eyes}
      ${nose}
      ${mouth}
      ${detail}
    </g>
  </svg>`
}

export const profileAvatarPresets: ProfileAvatarPreset[] = Array.from({ length: 50 }, (_, index) => {
  const recipe = getRecipe(index)

  return {
    id: `notion-face-${String(index + 1).padStart(2, "0")}`,
    label: `${recipe.expression} ${recipe.hair} 얼굴 - ${recipe.detail}`,
    src: svgToDataUri(renderFaceAvatar(index)),
  }
})

export function getProfileAvatarPreset(srcOrId: string | null | undefined) {
  const value = String(srcOrId || "")
  return profileAvatarPresets.find((preset) => preset.id === value || preset.src === value) ?? profileAvatarPresets[0]
}
