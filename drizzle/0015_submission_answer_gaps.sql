-- What a Student wrote in each gap — #83.
--
-- A fill-gap Exercise can now have several gaps, and each is judged against its
-- own accepted values. The sentence stays in `answer`, which is what every
-- screen shows and what the Grader's Progressive Hints carry; this is the list
-- behind it, and it is what a Dispute promotes to an Accepted Variant and what
-- says which gaps were not accepted.
--
-- Empty on every other Kind, and empty on every Submission written before this
-- column existed. Those are not backfilled: their `answer` is the single word a
-- one-gap Exercise was answered with, which is a true record of what happened,
-- and reassembling a sentence for it would put the Student's word into whatever
-- the prompt says today. The two readers that need gaps fall back to the answer
-- where the list is empty, which for one gap is the same value.

ALTER TABLE `submissions` ADD `answer_gaps` text DEFAULT '[]' NOT NULL;
