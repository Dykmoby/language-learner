'use client';

// The model and the Effort, chosen per request.
//
// Per request rather than stored on the Course, and design.md § Authoring is
// explicit about why: it is a judgement about *this* Lesson, made by someone who
// knows how hard this Lesson is. Both Generation and Refinement ask it, so it is
// one control rather than two that could come to offer different things.

import { ru } from '../../../../ru.ts';
import { AUTHOR_MODELS } from '../../../../content/course-options.ts';
import { EFFORT_CHOICES } from '../../../../authoring/form.ts';
import type { Effort } from '../../../../claude/effort.ts';

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

      <label>
        <span>{ru.generation.effort}</span>
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
      <p className="muted">{ru.generation.effortHint}</p>
    </>
  );
}
