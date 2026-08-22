// What a Student gets wrong, counted — «Артикли — 14 ошибок».
//
// The Russian label is resolved here, at display time, and never read from
// storage: only the label changes, and storage has to survive that. An Error Type
// the enum does not know about falls through `errorTypeLabel` and is shown as it
// came, because dropping it would hide a real fault from the only person who
// could fix it.
//
// A bar and a number, not a bar alone: the bar is the shape of the answer and the
// number is the answer, and a screen reader gets only one of the two.

import { ru, errorTypeLabel } from '../../../../ru.ts';
import type { ErrorCount } from '../../../../progress/errors.ts';

export function ErrorHistogram({ counts }: { counts: ErrorCount[] }) {
  // Says so rather than rendering an empty table, which reads like a fault.
  if (counts.length === 0) return <p className="muted">{ru.errorStats.none}</p>;

  // The largest is what every other bar is drawn against. It is the first, since
  // the counts arrive ordered, but taking the maximum says why rather than
  // relying on that.
  const largest = counts.reduce((most, entry) => Math.max(most, entry.count), 0);

  return (
    <>
      <p className="muted">{ru.errorStats.hint}</p>
      <table className="histogram">
        <thead>
          <tr>
            <th scope="col">{ru.errorStats.typeHeading}</th>
            <th scope="col">{ru.errorStats.countHeading}</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((entry) => (
            <tr key={`${entry.language}:${entry.type}`}>
              <th scope="row">{errorTypeLabel(entry.type)}</th>
              <td>
                <span className="bar" style={{ width: `${Math.round((entry.count / largest) * 100)}%` }} />
                <span className="value">{ru.errorStats.count(entry.count)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
