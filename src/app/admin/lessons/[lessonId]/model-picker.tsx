'use client';

// The model and the Effort, chosen per request.
//
// Per request rather than stored on the Course, and design.md § Authoring is
// explicit about why: it is a judgement about *this* Lesson, made by someone who
// knows how hard this Lesson is. Both Generation and Refinement ask it, so it is
// one control rather than two that could come to offer different things.

import { ru } from '../../../../ru.ts';
import { AUTHOR_MODELS } from '../../../../content/course-options.ts';
import type { Effort } from '../../../../claude/effort.ts';
import { EffortSelect } from '../../effort-select.tsx';

type Props = {
  model: string;
  /** Null is «По умолчанию» — the parameter is not sent at all. */
  effort: Effort | null;
  disabled: boolean;
  onModel: (model: string) => void;
  onEffort: (effort: Effort | null) => void;
};

export function ModelAndEffort({ model, effort, disabled, onModel, onEffort }: Props) {
  return (
    <>
      <label>
        <span>{ru.generation.model}</span>
        <select value={model} onChange={(e) => onModel(e.target.value)} disabled={disabled}>
          {AUTHOR_MODELS.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>

      <EffortSelect
        label={ru.generation.effort}
        hint={ru.generation.effortHint}
        effort={effort}
        disabled={disabled}
        onEffort={onEffort}
      />
    </>
  );
}
