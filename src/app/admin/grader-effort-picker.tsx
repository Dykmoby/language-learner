'use client';

// The Grader's Effort for one Course — issue #76, ADR 0007.
//
// One control rather than two, because it is asked in two places: when a Course
// is created and afterwards on its settings screen. Two copies would eventually
// offer different things, and the thing they would differ about is how long a
// Student waits.
//
// «По умолчанию» is the *absence* of the parameter rather than a value of it,
// exactly as it is for Generation — expressed as `null` here, because a `<select>`
// has to name it, and as a missing key by the time it reaches the SDK.

import { ru } from '../../ru.ts';
import { EFFORT_CHOICES } from '../../authoring/form.ts';
import type { Effort } from '../../claude/effort.ts';

type Props = {
  effort: Effort | null;
  disabled: boolean;
  onEffort: (effort: Effort | null) => void;
};

export function GraderEffortPicker({ effort, disabled, onEffort }: Props) {
  return (
    <>
      <label>
        <span>{ru.admin.graderEffortField}</span>
        <select
          value={effort ?? ''}
          onChange={(e) => onEffort(e.target.value === '' ? null : e.target.value as Effort)}
          disabled={disabled}
        >
          {EFFORT_CHOICES.map((choice) => (
            <option key={choice ?? 'default'} value={choice ?? ''}>
              {choice === null ? ru.generation.effortDefault : ru.efforts[choice] ?? choice}
            </option>
          ))}
        </select>
      </label>
      {/* The cost is a wait, and the person who waits is not the person choosing.
          Saying so here is the Admin's half; the Practice screen tells the
          Student what they are waiting for. */}
      <p className="muted">{ru.admin.graderEffortHint}</p>
    </>
  );
}
