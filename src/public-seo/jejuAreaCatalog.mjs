export const jejuAliasClusters = [
  {
    slug: "samhwa",
    name: "삼화지구 생활권",
    aliases: ["삼화지구", "삼화", "삼화택지지구"],
    districts: ["삼양동", "화북동", "봉개동"],
    summary:
      "삼화지구, 삼양, 화북, 봉개 생활권에서 오가는 학생과 학부모가 자주 찾는 제주시 동부권 안내 섹션입니다.",
  },
  {
    slug: "sinjeju",
    name: "신제주 생활권",
    aliases: ["신제주", "제주시 중심 상권", "제주시 서부 중심"],
    districts: ["연동", "노형동", "오라동"],
    summary:
      "연동, 노형동, 오라동을 포함한 신제주 생활권에서 영어학원과 수학학원을 찾는 수요를 위한 안내 섹션입니다.",
  },
  {
    slug: "gujeju",
    name: "구제주 생활권",
    aliases: ["구제주", "원도심", "동문시장 생활권"],
    districts: [
      "일도1동",
      "일도2동",
      "이도1동",
      "이도2동",
      "삼도1동",
      "삼도2동",
      "건입동",
      "용담1동",
      "용담2동",
    ],
    summary:
      "구제주와 원도심에서 통학하는 학생을 기준으로 정리한 제주시 북동권 안내 섹션입니다.",
  },
];

export const jejuAdministrativeDongs = [
  {
    slug: "ildo1",
    name: "일도1동",
    aliases: ["탑동", "동문시장 인근", "구제주 북부"],
    cluster: "구제주 생활권",
  },
  {
    slug: "ildo2",
    name: "일도2동",
    aliases: ["일도이동", "동광로 인근", "구제주 동부"],
    cluster: "구제주 생활권",
  },
  {
    slug: "ido1",
    name: "이도1동",
    aliases: ["이도일동", "제주시청 인근", "구제주 중심"],
    cluster: "구제주 생활권",
  },
  {
    slug: "ido2",
    name: "이도2동",
    aliases: ["이도이동", "제주시청", "중앙여고 인근"],
    cluster: "구제주 생활권",
  },
  {
    slug: "samdo1",
    name: "삼도1동",
    aliases: ["삼도일동", "서사라권", "구제주 남부"],
    cluster: "구제주 생활권",
  },
  {
    slug: "samdo2",
    name: "삼도2동",
    aliases: ["삼도이동", "제주중앙로", "구제주 서부"],
    cluster: "구제주 생활권",
  },
  {
    slug: "geonip",
    name: "건입동",
    aliases: ["건입", "제주항 인근", "사라봉 생활권"],
    cluster: "구제주 생활권",
  },
  {
    slug: "yongdam1",
    name: "용담1동",
    aliases: ["용담일동", "공항 북측", "제주공항 인근"],
    cluster: "구제주 생활권",
  },
  {
    slug: "yongdam2",
    name: "용담2동",
    aliases: ["용담이동", "용담해안도로", "공항 서측"],
    cluster: "구제주 생활권",
  },
  {
    slug: "hwabuk",
    name: "화북동",
    aliases: ["화북", "화북일동", "삼화 북측"],
    cluster: "삼화지구 생활권",
  },
  {
    slug: "samyang",
    name: "삼양동",
    aliases: ["삼양", "삼양일동", "삼화 남측"],
    cluster: "삼화지구 생활권",
  },
  {
    slug: "bonggae",
    name: "봉개동",
    aliases: ["봉개", "봉개 생활권", "제주시 동부 외곽"],
    cluster: "삼화지구 생활권",
  },
  {
    slug: "ara",
    name: "아라동",
    aliases: ["아라", "제주대학교병원 인근", "아라지구"],
    cluster: "제주시 동부권",
  },
  {
    slug: "ora",
    name: "오라동",
    aliases: ["오라", "오라일동", "오라동 주민센터 인근"],
    cluster: "신제주 생활권",
  },
  {
    slug: "yeondong",
    name: "연동",
    aliases: ["연동 중심", "신제주", "제주시청 제2청사 인근"],
    cluster: "신제주 생활권",
  },
  {
    slug: "noyeong",
    name: "노형동",
    aliases: ["노형", "노형오거리", "신제주 서부"],
    cluster: "신제주 생활권",
  },
  {
    slug: "oedo",
    name: "외도동",
    aliases: ["외도", "외도이동", "제주시 서부 해안권"],
    cluster: "제주시 서부권",
  },
  {
    slug: "iho",
    name: "이호동",
    aliases: ["이호", "이호테우", "공항 서부 해안권"],
    cluster: "제주시 서부권",
  },
  {
    slug: "dodu",
    name: "도두동",
    aliases: ["도두", "도두봉 인근", "제주시 서북부"],
    cluster: "제주시 서부권",
  },
];

export const jejuAreaServed = [
  "제주시",
  ...jejuAliasClusters.flatMap((cluster) => [cluster.name, ...cluster.aliases]),
  ...jejuAdministrativeDongs.flatMap((district) => [
    district.name,
    ...district.aliases,
  ]),
];

export function buildUniqueJejuAreaServedList() {
  return [...new Set(jejuAreaServed)];
}

