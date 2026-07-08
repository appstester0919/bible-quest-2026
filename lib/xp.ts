/**
 * XP ↔ Level conversion utilities.
 * Level formula (DB trigger): level = floor(sqrt(total_xp / 100)) + 1
 * So: total_xp_for_level(l) = (l-1)² × 100
 * Level 1 → 0 XP, Level 2 → 100 XP, Level 3 → 400 XP, Level 4 → 900 XP …
 */

/** XP required to reach a given level */
export function getXpForLevel(level: number): number {
  return (level - 1) ** 2 * 100
}

/** XP progress within current level as a percentage (0–100) */
export function getXpProgress(totalXp: number, currentLevel: number): number {
  const xpForCurrent = getXpForLevel(currentLevel)
  const xpForNext    = getXpForLevel(currentLevel + 1)
  const range = xpForNext - xpForCurrent
  if (range === 0) return 0
  return Math.min(100, ((totalXp - xpForCurrent) / range) * 100)
}
