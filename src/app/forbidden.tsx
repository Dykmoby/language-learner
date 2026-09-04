// What a 403 looks like. Reached through forbidden() — today only from a locked
// Lesson, which is refused with a status rather than merely with an apology.

import { ru } from '../ru.ts';

export default function Forbidden() {
  return (
    <main>
      <h1>{ru.course.locked}</h1>
      <p className="error" role="alert">{ru.course.lockedRefusal}</p>
      {/* `/courses` rather than `/`: the home screen redirects into the Current
          Course, which for a Student who has just been refused a locked Lesson
          is the Course they were refused it in. */}
      <p className="actions"><a className="button" href="/courses">{ru.course.back}</a></p>
    </main>
  );
}
