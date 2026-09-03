'use client';

// The Admin's way of opening somebody else's record: the same screen at the same
// address, with the Student named in the query string.
//
// A plain navigation rather than a fetch, so the address bar says whose record is
// on the screen and the link can be sent to somebody.
//
// It was a bare `<select>`, which is the one control a browser insists on
// drawing itself — square corners, its own arrow, its own font — beside a screen
// of rounded cards. Mantine's is a listbox this application draws, so it takes
// the same radius and the same edge as every other control here.

import { Select } from '@mantine/core';
import { ru } from '../../../../ru.ts';

type Props = {
  courseId: number;
  students: Array<{ id: number; username: string }>;
  selected: number;
};

export function StudentPicker({ courseId, students, selected }: Props) {
  return (
    <Select
      label={ru.progress.chooseStudent}
      value={String(selected)}
      data={students.map((student) => ({ value: String(student.id), label: student.username }))}
      onChange={(value) => {
        if (value === null) return;
        window.location.href = `/courses/${courseId}/progress?student=${value}`;
      }}
      // The list is two or three people. A search box over three names is a
      // control asking to be used for nothing.
      searchable={false}
      w="14rem"
    />
  );
}
