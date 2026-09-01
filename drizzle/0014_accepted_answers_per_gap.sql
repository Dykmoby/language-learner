-- Accepted answers become a list per gap — #82.
--
-- An Exercise stored one flat list of whole answers. A fill-gap with several
-- gaps needs a list *per gap*, so every stored list is wrapped into the single
-- position it has always been. Nothing an Admin or a Student can see changes:
-- one position holding the same values is judged exactly as the flat list was.
--
-- Data, not schema. The column is JSON either way, so there is nothing to alter
-- — which is also why this cannot be left to the type: a row that kept its flat
-- list would be read as a list of characters, and every answer would be wrong.
--
-- Both statements test the shape before they write, so re-running this migrates
-- nothing twice. An empty list is nothing accepted in both formats and is left
-- alone: a Grader-judged Exercise must not gain a position.

UPDATE exercises
SET accepted_answers = json_array(json(accepted_answers))
WHERE json_type(accepted_answers, '$[0]') = 'text';
--> statement-breakpoint
-- A Draft holds a whole Lesson as one JSON document (ADR 0004), so its
-- Exercises carry accepted answers too. Left flat, restoring an old Draft — or
-- publishing one that was already open when this shipped — would write a flat
-- list straight back into the Practice a Student reads.
UPDATE lesson_drafts
SET document = json_set(document, '$.exercises', (
  SELECT json_group_array(
    CASE json_type(exercise.value, '$.acceptedAnswers[0]')
      WHEN 'text' THEN json_set(
        exercise.value,
        '$.acceptedAnswers',
        json_array(json_extract(exercise.value, '$.acceptedAnswers'))
      )
      ELSE json(exercise.value)
    END)
  FROM json_each(lesson_drafts.document, '$.exercises') AS exercise))
WHERE EXISTS (
  SELECT 1 FROM json_each(lesson_drafts.document, '$.exercises') AS exercise
  WHERE json_type(exercise.value, '$.acceptedAnswers[0]') = 'text');
