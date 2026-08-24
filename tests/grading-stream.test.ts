// The seam where the two tested halves are joined: raw deltas in, frames out.
//
// A route handler needs a booted application and a live model. This needs
// neither — the deltas are a fabricated JSON payload cut at chosen points, which
// is the only way to control where a split lands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradingStream } from '../src/practice/stream.ts';
import { takeFrames, type Frame, type ResultFrame } from '../src/practice/wire.ts';

const FEEDBACK = 'Почти! Артикль «a» перед исчисляемым существительным обязателен.';

const PAYLOAD = JSON.stringify({
  feedback_ru: FEEDBACK,
  corrected: 'I have a cat.',
  errors: [{ type: 'article', span: 'have cat', explanation_ru: 'Пропущен артикль.' }],
  verdict: 'partially_correct',
});

const RESULT: ResultFrame = {
  t: 'result',
  status: 'graded',
  submissionId: 1,
  verdict: 'partially_correct',
  failure: null,
  feedbackRu: FEEDBACK,
  corrected: 'I have a cat.',
  errors: [{ type: 'article', span: 'have cat', explanationRu: 'Пропущен артикль.' }],
  progression: {
    advanced: false, nextExerciseId: 1, lessonComplete: false,
    failedAttempts: 1, revealOffered: false,
  },
};

/** The payload arriving in chunks of `size`, the way the SDK hands it over. */
async function* inChunks(payload: string, size: number): AsyncIterable<string> {
  for (let at = 0; at < payload.length; at += size) {
    yield payload.slice(at, at + size);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Frame[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: Frame[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const taken = takeFrames(buffer);
    buffer = taken.rest;
    frames.push(...taken.frames);
  }
  assert.equal(buffer, '', 'the stream ends on a frame boundary');
  return frames;
}

test('the explanation streams as deltas and the Verdict arrives whole, at the end', async () => {
  const frames = await collect(gradingStream({
    deltas: inChunks(PAYLOAD, 7),
    frame: Promise.resolve(RESULT),
  }));

  const deltas = frames.filter((f) => f.t === 'delta');
  const results = frames.filter((f) => f.t === 'result');

  assert.ok(deltas.length > 1, 'the explanation arrived in pieces rather than in one lump');
  assert.equal(results.length, 1, 'exactly one terminal frame');
  assert.equal(frames.at(-1)?.t, 'result', 'and it is last');

  const streamed = deltas.map((f) => (f.t === 'delta' ? f.text : '')).join('');
  assert.equal(streamed, FEEDBACK, 'the pieces reassemble into exactly the explanation');
});

test('the Student never sees JSON syntax, whatever size the chunks are', async () => {
  // One character at a time is the worst case: every escape and every field
  // boundary is split.
  for (const size of [1, 2, 3, 5, 13, PAYLOAD.length]) {
    const frames = await collect(gradingStream({
      deltas: inChunks(PAYLOAD, size),
      frame: Promise.resolve(RESULT),
    }));

    const streamed = frames.filter((f) => f.t === 'delta')
      .map((f) => (f.t === 'delta' ? f.text : '')).join('');

    assert.equal(streamed, FEEDBACK, `chunks of ${size}: the explanation is intact`);
    assert.ok(!/[{}]/.test(streamed), `chunks of ${size}: no braces`);
    assert.ok(!streamed.includes('feedback_ru'), `chunks of ${size}: no field name`);
    assert.ok(!streamed.includes('corrected'), `chunks of ${size}: nothing from the next field`);
  }
});

test('the Errors do not stream — they arrive only in the terminal frame', async () => {
  const frames = await collect(gradingStream({
    deltas: inChunks(PAYLOAD, 4),
    frame: Promise.resolve(RESULT),
  }));

  for (const frame of frames) {
    if (frame.t === 'delta') {
      assert.ok(!frame.text.includes('article'), 'a half-arrived error list is not information');
    }
  }

  const result = frames.at(-1) as ResultFrame;
  assert.deepEqual(result.errors, RESULT.errors, 'they arrive complete, once');
});

test('a failed grading streams nothing and still delivers its terminal frame', async () => {
  const failure: ResultFrame = {
    t: 'result', status: 'grading_failed', submissionId: 1, verdict: null, failure: 'broken',
    feedbackRu: null, corrected: null, errors: [],
    progression: {
      advanced: false, nextExerciseId: 1, lessonComplete: false,
      failedAttempts: 0, revealOffered: false,
    },
  };

  // Nothing was ever emitted: the call died before the model wrote a character.
  const frames = await collect(gradingStream({
    deltas: inChunks('', 1),
    frame: Promise.resolve(failure),
  }));

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], failure);
});

test('a Grader that wrapped its JSON in a markdown fence still streams clean', async () => {
  const fenced = '```json\n' + PAYLOAD + '\n```';
  const frames = await collect(gradingStream({
    deltas: inChunks(fenced, 6),
    frame: Promise.resolve(RESULT),
  }));

  const streamed = frames.filter((f) => f.t === 'delta')
    .map((f) => (f.t === 'delta' ? f.text : '')).join('');
  assert.equal(streamed, FEEDBACK, 'the fence never reaches the Student');
  assert.ok(!streamed.includes('`'));
});

test('the stream closes even when the terminal frame is slow, and never before it', async () => {
  let resolveFrame: (frame: ResultFrame) => void = () => {};
  const frame = new Promise<ResultFrame>((resolve) => { resolveFrame = resolve; });

  const stream = gradingStream({ deltas: inChunks(PAYLOAD, 9), frame });
  const collected = collect(stream);

  // The deltas are long finished; the result is not. The stream must wait.
  await new Promise((resolve) => setTimeout(resolve, 50));
  resolveFrame(RESULT);

  const frames = await collected;
  assert.equal(frames.at(-1)?.t, 'result', 'the Verdict is never dropped for being late');
});
