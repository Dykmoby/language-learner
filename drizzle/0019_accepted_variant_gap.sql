-- Which Gap an Accepted Variant was confirmed for — #85.
--
-- An Accepted Variant is recorded against the Exercise, and until now it joined
-- every Gap of it. On a fill-gap with several Gaps that is wrong in a way that
-- teaches the mistake: a word upheld for the second Gap of «___ have ___ apple»
-- started marking that word correct in the first as well.
--
-- Null is "no position", which is what every Kind with one place to answer holds
-- and what every variant written before this column holds. Those keep joining
-- every Gap — a true record of what they were confirmed as, and for a one-gap
-- Exercise the same values either way. Nothing is backfilled: nobody can say now
-- which Gap of a multi-gap Exercise an older variant was meant for, and guessing
-- would attach a teacher-confirmed answer to a position no teacher chose.

ALTER TABLE `accepted_variants` ADD `gap` integer;
