// Moving one item of an ordered list, by one place.
//
// Both things an Admin reorders — the Lessons of a Course, the Exercises of a
// Practice — are ordered lists whose order is the whole point, and both are
// rearranged the same way: pick one up, put it down one place along. One
// definition, so the two screens cannot drift into disagreeing about what
// "выше" does at the ends of a list.
//
// Pure, and returns a new list: the caller shows the result immediately and puts
// the old one back if the write is refused, which is only possible if it still
// has the old one.

/** The list with the item at `index` moved by `by` places, or the same list where it cannot move. */
export function movedWithin<T>(items: readonly T[], index: number, by: number): T[] {
  const target = index + by;
  if (index < 0 || index >= items.length) return [...items];
  if (target < 0 || target >= items.length) return [...items];

  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}
