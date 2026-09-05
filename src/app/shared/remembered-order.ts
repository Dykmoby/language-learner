'use client';

// One Exercise's shuffled order, kept for as long as the tab lives.
//
// Reshuffling on every render would move the options under a Student's cursor;
// reshuffling on every visit to the same Exercise would move them between a
// wrong answer and the second attempt at it, which is the one moment the screen
// has to sit still. So the order is drawn once per Exercise and remembered —
// a reload, a walk through the Set and back, a second attempt all find the
// screen the way it was left. A new session draws a new one, which is what keeps
// a Set from having one fixed shape to memorise.
//
// `sessionStorage` rather than the Student's row: this is a fact about one tab's
// view of one Exercise that nothing derives anything from, and it stops being
// interesting the moment the tab closes. It is the same reasoning as
// `remembered-flag.ts`, one storage shorter.
//
// The shuffle is drawn in an effect rather than during a render, because the
// server rendered these choices in the authored order and a render that shuffled
// would disagree with the HTML it was sent. The effect is a layout one, so the
// authored order is replaced before the browser paints rather than a frame after
// it — on a word order that first frame would be the answer.

import { useState } from 'react';
import { useIsomorphicEffect } from '@mantine/hooks';
import { inOrder, isOrder, shuffle } from './choice-order.ts';

const keyOf = (exerciseId: number) => `exercise.${exerciseId}.choiceOrder`;

/** The order to show one Exercise's choices in, drawn once and kept. */
export function useRememberedOrder(exerciseId: number, count: number): number[] {
  const [order, setOrder] = useState<number[]>(() => inOrder(count));

  useIsomorphicEffect(() => {
    setOrder(rememberedOrder(exerciseId, count));
  }, [exerciseId, count]);

  // An Exercise changing under the hook is one render ahead of its effect, and
  // for that render the order belongs to the Exercise before it. The authored
  // order is the honest answer until the effect has drawn the real one.
  return isOrder(order, count) ? order : inOrder(count);
}

function rememberedOrder(exerciseId: number, count: number): number[] {
  // A Kind with nothing to choose between has no order, and no reason to leave
  // anything behind in storage.
  if (count === 0) return [];

  const key = keyOf(exerciseId);

  try {
    const held = window.sessionStorage.getItem(key);
    const parsed: unknown = held === null ? null : JSON.parse(held);
    if (isOrder(parsed, count)) return parsed;
  } catch {
    // Nothing readable there — no storage at all, or something that is no longer
    // an order for these choices. A fresh shuffle is the answer either way.
  }

  const order = shuffle(count);

  try {
    window.sessionStorage.setItem(key, JSON.stringify(order));
  } catch {
    // The shuffle holds for this screen; it is only the memory of it that is gone,
    // and the cost of that is a different order on the way back.
  }

  return order;
}
