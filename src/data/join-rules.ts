// Which letter pairs join, for skeletons that follow a join table rather than joining everything.
// A pair a→b joins when a is in `from` and b is in `to`, unless listed in `never`; pairs in
// `always` join regardless. Only lowercase letters inside a word ever join. The hand's `joins`
// setting then decides how consistently the allowed pairs actually get joined.
import type { SkeletonId } from '../core/profile';

export interface JoinRules {
  /** Letters whose last stroke can lead into the next letter. */
  from: string;
  /** Letters that can be entered from the previous letter. */
  to: string;
  always?: string[];
  never?: string[];
}

export const JOIN_RULES: Partial<Record<SkeletonId, JoinRules>> = {
  // Modern semi-joined print, built on Readability.
  semijoined: {
    // Letters that finish at the bottom right (plus c and r, whose ends reach the next letter).
    // Not from: b g j o p q s u v w x y z — bowls, descenders and letters ending at the top.
    from: 'acdehiklmnrt',
    // Letters entered at the top-left of a stroke or stem.
    // Not into: a c d g o q (bowls that start on the right), b h k l (ascender tops), j s x z.
    to: 'efimnpruvwy',
    always: [],
    never: [],
  },
};
