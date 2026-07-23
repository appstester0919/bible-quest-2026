// ─── User Identity (single source of truth) ────────────────────────────────
// Each user belongs to exactly one identity (one of 爾國臨格 / 夥熱 / 新生不Sick
// summer camps). The identity drives:
//   - Background image (set via <body data-identity="..."> + CSS variable)
//   - Default copy / terminology in the app
//   - Future feature gates (e.g. exclusive tabs for 高中生 only)
//
// Iron rule: any code that branches on identity must use `IDENTITIES[identity]`
// or `hasFeature(identity, feature)` from this file. Never hardcode the strings
// 'Uni' / 'High' / 'Prim' or the camp names in scattered components — they
// belong here.

export type Identity = 'Uni' | 'High' | 'Prim';

export const IDENTITIES: Record<Identity, {
  /** English code (DB value) */
  code: Identity;
  /** 繁體中文 display name with camp tag */
  name_zh: string;
  /** Short camp name only (without age group) */
  camp: string;
  /** Age-group label, separate from camp name */
  age_group_zh: string;
  /** Background image URL (relative to /public) */
  bg: string;
  /** Short tagline shown on signup preview (1 sentence) */
  preview: string;
}> = {
  Uni: {
    code: 'Uni',
    name_zh: '大專生 / 爾國臨格',
    camp: '爾國臨格',
    age_group_zh: '大專生',
    bg: '/identity-bg/Uni.jpg',
    preview: '適合大專基督徒深度讀經、彼此激勵。',
  },
  High: {
    code: 'High',
    name_zh: '高中生 / 夥熱',
    camp: '夥熱',
    age_group_zh: '高中生',
    bg: '/identity-bg/High.jpg',
    preview: '適合高中生輕鬆讀經、與同路人同行。',
  },
  Prim: {
    code: 'Prim',
    name_zh: '小五六 / 新生不Sick',
    camp: '新生不Sick',
    age_group_zh: '小五六',
    bg: '/identity-bg/Prim.jpg',
    preview: '適合小五六輕鬆入門、認識聖經。',
  },
};

export const ALL_IDENTITIES: Identity[] = ['Uni', 'High', 'Prim'];

/** Type guard for runtime values from DB / form input */
export function isIdentity(v: unknown): v is Identity {
  return v === 'Uni' || v === 'High' || v === 'Prim';
}

/** Safe default for new signups (most common case = 大專生 / 爾國臨格) */
export const DEFAULT_IDENTITY: Identity = 'Uni';

// ─── Feature gates (extensible) ────────────────────────────────────────────
// Future-proof: when 高中生 users get exclusive features (e.g. a 高中 prayer
// wall, a 高中-only calendar), add them here. Other code calls
// `hasFeature(user.identity, 'high_school_prayer_wall')` instead of hardcoding
// `if (user.identity === 'High')`.
const IDENTITY_FEATURES: Record<Identity, readonly string[]> = {
  Uni:  [],
  High: [],
  Prim: [],
};

export function hasFeature(identity: Identity | null | undefined, feature: string): boolean {
  if (!identity) return false;
  return IDENTITY_FEATURES[identity]?.includes(feature) ?? false;
}
