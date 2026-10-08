// The run order (ADR-0016). A block is one baseline run and one catenet run of the same task, back to back in random
// order; blocks are shuffled with a recorded seed. Pairing by block controls for drift over the run (API changes,
// rate limits), and a cost stop between blocks keeps both conditions balanced.
import { rng, shuffle } from "./rng.js";

export const CONDITIONS = ["baseline", "catenet"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Block {
  /** Position in the schedule. */
  index: number;
  task: string;
  /** 0-based repetition of this task. */
  trial: number;
  order: [Condition, Condition];
}

export function makeSchedule(taskIds: readonly string[], trials: number, seed: number): Block[] {
  const random = rng(seed);
  const blocks: Omit<Block, "index" | "order">[] = [];
  for (const task of taskIds) for (let trial = 0; trial < trials; trial++) blocks.push({ task, trial });
  return shuffle(blocks, random).map((b, index) => ({
    ...b,
    index,
    order: random() < 0.5 ? ["baseline", "catenet"] : ["catenet", "baseline"],
  }));
}
