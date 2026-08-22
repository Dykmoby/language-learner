'use client';

// The Admin's way of opening somebody else's record: the same screen at the same
// address, with the Student named in the query string.
//
// A plain navigation rather than a fetch, so the address bar says whose record is
// on the screen and the link can be sent to somebody.

import { ru } from '../../../../ru.ts';

type Props = {
  courseId: number;
  students: Array<{ id: number; username: string }>;
  selected: number;
};

export function StudentPicker({ courseId, students, selected }: Props) {
  return (
    <p className="actions">
      <label className="inline">
        <span>{ru.progress.chooseStudent}{': '}</span>
        <select
          defaultValue={String(selected)}
          onChange={(event) => {
            window.location.href = `/courses/${courseId}/progress?student=${event.target.value}`;
          }}
        >
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.username}</option>
          ))}
        </select>
      </label>
    </p>
  );
}
