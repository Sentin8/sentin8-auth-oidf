// SPDX-FileCopyrightText: Copyright Logically Magic Inc. <hello@logicallymagic.com>
// SPDX-FileCopyrightText: Copyright Hamid Jahanzad <Hamid@Jahanzad.com>
// SPDX-License-Identifier: Apache-2.0

// fixtures/log.ts - run-step logging (mirrors sentin8-e2e fixtures/log.ts).

const steps: string[] = [];

/** Log one orchestration step (console + in-memory buffer). */
export function logStep(msg: string): void {
  const line = `[oidf] ${new Date().toISOString()} ${msg}`;
  steps.push(line);
  console.log(line);
}

/** The whole run's step log (written to results/ by the reporter). */
export function stepLog(): string {
  return steps.join('\n');
}