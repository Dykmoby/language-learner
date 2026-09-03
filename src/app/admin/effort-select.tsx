'use client';

// The Effort, chosen from a list — the one control, wherever an Effort is asked
// for.
//
// It is asked for in three places now: a Generation, a Refinement, and a Course
// (issue #76). What differs between them is what the Effort is *for*, which is
// the label and the sentence under it; what must not differ is the list, the
// order, and how «По умолчанию» is offered. Two copies of a `<select>` would
// eventually offer different things, and the thing they would differ about is
// how long somebody waits.
//
// «По умолчанию» is the *absence* of the parameter rather than a value of it. It
// is `null` here because a `<select>` has to name every option it offers, and a
// missing key by the time it reaches the SDK.

import { NativeSelect } from '@mantine/core';
import { ru } from '../../ru.ts';
import { EFFORT_CHOICES } from '../../authoring/form.ts';
import type { Effort } from '../../claude/effort.ts';

type Props = {
  /** What this Effort is for, in Russian. */
  label: string;
  /** What choosing a higher one costs, in Russian. */
  hint: string;
  effort: Effort | null;
  disabled: boolean;
  onEffort: (effort: Effort | null) => void;
};

export function EffortSelect({ label, hint, effort, disabled, onEffort }: Props) {
  // A native select rather than Mantine's listbox, and deliberately: this is a
  // fixed list of six that an Admin picks from with the keyboard while writing a
  // Lesson, and the one thing it must never do is float a panel over the form it
  // sits in. Mantine draws the box, so it matches every other control here.
  return (
    <NativeSelect
      label={label}
      description={hint}
      value={effort ?? ''}
      disabled={disabled}
      onChange={(event) => {
        const chosen = event.currentTarget.value;
        onEffort(chosen === '' ? null : chosen as Effort);
      }}
      data={EFFORT_CHOICES.map((choice) => ({
        value: choice ?? '',
        label: choice === null ? ru.generation.effortDefault : ru.efforts[choice] ?? choice,
      }))}
    />
  );
}
