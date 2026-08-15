/**
 * Group nudge sample pool — 12 條 user-locked pushes.
 *
 * Source of truth: ~/.hermes/templates/bible-quest-2026/nudge/samples_zh-HK.json
 * Locked by KH LAI 2026-08-15. Do not edit without user approval — these are
 * the canonical wording shown in the "random 2 of 12" picker UI.
 *
 * Conventions:
 *   - [SENDER_NAME] placeholder is replaced at send-time by
 *     fillNudgeSenderName() — the actual sender's display name becomes the
 *     push payload's `title` for social-proof (Duolingo Friend Streak pattern).
 *   - Hard-banned phrases (仲未完成讀經 / 未完成 / 仲差 / 進度落後 / etc.)
 *     were audited out before lock — see audit script in
 *     ~/.hermes/templates/bible-quest-2026/nudge/samples_zh-HK.json §_meta.
 *   - "DuoBible" is the locked product name; do NOT change to "Bible Quest".
 */

export const NUDGE_SAMPLES: readonly string[] = [
  '[SENDER_NAME] 啱啱幫你加油打氣！每日一小步，一齊行條讀經路。依家得閒不如入嚟 DuoBible 睇吓，神嘅說話隨時都喺度等緊你，一齊加油啦！✨',
  '[SENDER_NAME] 嚟同你揮揮手啦！每日同主親近，有伴一齊行先至最溫馨。依家即刻打開 DuoBible，聽吓今日神想對你講啲咩啦，等緊你一齊出發！🧭',
  '[SENDER_NAME] 拍拍你膊頭，問你今日過得點？忙碌之中，最啱就係靜落來睇幾句聖經，重新得力。依家點入嚟一齊充吓電，等神嘅說話照亮你今日嘅步伐啦！🕯️',
  '收到 [SENDER_NAME] 傳過嚟嘅暖心電波未？讀經修行唔使孤軍作戰，有大家互相守望。依家就入嚟 DuoBible，等我哋一齊喺主嘅話語裡面搵到今日最正嘅力量！🔥',
  '[SENDER_NAME] 話驚你今日太忙，所以特登發個溫馨提示俾你。工作再忙碌，都記得留番一個專屬你同神嘅時間，入嚟同大家一齊得力。等緊你隨時入嚟！🌈',
  '[SENDER_NAME] 啱啱完成咗今日嘅讀經，依家傳個接力棒俾你啦！一齊作同伴行路，越行就越有力量。依家就入嚟打開 DuoBible，一齊享受今日嘅靈糧啦！🏃',
  '[SENDER_NAME] 提提你，組員大家都掛住你呀 💪 呢條信仰路有你同行更精彩呀 📖 期待你嘅參與',
  '[SENDER_NAME] 提提你，今晚得閒就坐低讀下經文 ☕ 唔使當做任務，享受同神對話嘅時光就好，慢慢感受神嘅同在 ✨',
  '[SENDER_NAME] 提提你，每日堅持真係唔容易，所以我嚟為你送上支持！無論今日幾忙碌都好，留返少少時間安靜下心靈，我哋喺讀經路上繼續拍住上啦！🌟',
  '[SENDER_NAME] 想同你講，每日生活就算幾忙，都記得留返個安靜時間畀自己呀。我哋成組人一齊養成每日睇聖經嘅好習慣，繼續互相鼓勵，等你！🤝',
  '[SENDER_NAME] 提提你，每日嘅安靜時間係最好嘅心靈充電時刻！我已經充好電喇，你都快啲抽少少時間感受下神嘅同在，一齊喺信仰路上進步啦！🔋',
  '[SENDER_NAME] 想同你講：每日同神親近，係最治癒嘅時光。今晚瞓覺前，不妨靜落嚟睇幾段經文，等心靈好好放鬆，今晚都好瞓啲。🌟',
] as const

/**
 * Pick 2 random samples with no replacement. Returns [a, b] where a != b.
 * Used by the NudgeDialog UI to show the sender 2 sample options.
 */
export function pickRandomNudgeSamples(): [string, string] {
  const i = Math.floor(Math.random() * NUDGE_SAMPLES.length)
  let j = Math.floor(Math.random() * (NUDGE_SAMPLES.length - 1))
  if (j >= i) j++
  return [NUDGE_SAMPLES[i], NUDGE_SAMPLES[j]]
}

/**
 * Replace [SENDER_NAME] placeholder with the actual sender's display name.
 * Applied at send-time, before the body is persisted to group_nudges.custom_message.
 */
export function fillNudgeSenderName(template: string, senderName: string): string {
  return template.replaceAll('[SENDER_NAME]', senderName)
}