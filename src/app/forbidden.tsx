// What a 403 looks like. Reached through forbidden() — today only from a locked
// Lesson, which is refused with a status rather than merely with an apology.

import { ru } from '../ru.ts';

export default function Forbidden() {
  return (
    <main>
      <h1>{ru.course.locked}</h1>
      <p className="error" role="alert">{ru.course.lockedRefusal}</p>
      <p><a href="/">{ru.course.back}</a></p>
    </main>
  );
}
