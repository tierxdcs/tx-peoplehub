/**
 * Fixed sheet-metal fabrication routing reported by vendors during PRODUCTION.
 * A vendor progress update stores `completedSteps` = how many of these steps
 * (in order) are done; the current step is the next one. Progress percent is
 * derived: completedSteps / PLM_PRODUCTION_STEPS.length.
 *
 * Order is significant — index === sequence position.
 */
export const PLM_PRODUCTION_STEPS = [
  'Material',
  'Cut',
  'Punch',
  'Bend',
  'Weld',
  'Powder Coating',
  'Assemble',
  'QC',
  'Pack',
] as const;

export const PLM_PRODUCTION_STEP_COUNT = PLM_PRODUCTION_STEPS.length;

/** Percent complete derived from the number of completed steps. */
export function stepsToPercent(completedSteps: number): number {
  const clamped = Math.max(0, Math.min(PLM_PRODUCTION_STEP_COUNT, completedSteps));
  return Math.round((clamped / PLM_PRODUCTION_STEP_COUNT) * 100);
}
