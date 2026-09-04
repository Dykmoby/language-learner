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
            {/* One heading over two columns: the bar and the number are one
                answer to «сколько раз», drawn twice. */}
            <th scope="col" colSpan={2}>{ru.errorStats.countHeading}</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((entry) => (
            <tr key={`${entry.language}:${entry.type}`}>
              <th scope="row">{errorTypeLabel(entry.type)}</th>
              {/* Two cells, and that is the whole point of them. The number used
                  to follow the bar inside one cell — first in the text flow,
                  where a long bar pushed it onto a second line, then as a flex
                  item, where it took exactly as much width as its own text. That
                  second version was worse in a quieter way: «1 ошибка» and «12
                  ошибок» are different widths, so every row's track ended
                  somewhere slightly different and no two bars were drawn against
                  the same scale. A table column is uniform by construction, so
                  the number gets one and the bars are finally comparable. */}
              <td className="barCell">
                <span className="track">
                  <span className="bar" style={{ width: `${Math.round((entry.count / largest) * 100)}%` }} />
                </span>
              </td>
              <td className="value">{ru.errorStats.count(entry.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
