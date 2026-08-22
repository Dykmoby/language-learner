// The single central Russian dictionary. Every string a Student or Admin reads
// comes from here — design.md § Interface. No i18n library: adding a second
// interface language stays a translation job rather than a rewrite, which only
// holds while nothing writes Russian inline in a component.

// Russian needs three plural forms. Used by the lockout message, which has to
// state a real duration or the Student concludes the application is broken.
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function minutesRu(n: number): string {
  return `${n} ${plural(n, 'минуту', 'минуты', 'минут')}`;
}

export function secondsRu(n: number): string {
  return `${n} ${plural(n, 'секунду', 'секунды', 'секунд')}`;
}

export const ru = {
  appName: 'Языковой тренажёр',

  common: {
    signOut: 'Выйти',
    loading: 'Загрузка…',
    // The same act on both things an Admin reorders — the Lessons of a Course
    // and the Exercises of a Practice. One definition, so a translator sees it
    // once and the two screens cannot end up saying different words for it.
    moveUp: 'Выше',
    moveDown: 'Ниже',
  },

  login: {
    title: 'Вход',
    username: 'Имя пользователя',
    password: 'Пароль',
    submit: 'Войти',
    // Deliberately names neither field: saying which one was wrong hands
    // something to whoever is guessing.
    invalid: 'Неверное имя пользователя или пароль.',
    // The throttle makes the next attempt wait; this says so without promising
    // an exact moment, because the delay grows with each failure.
    slowDown: (seconds: number) =>
      `Слишком много неудачных попыток. Подождите ${secondsRu(seconds)} и попробуйте снова.`,
    lockedOut: (minutes: number) =>
      `Аккаунт временно заблокирован после пяти неудачных попыток. Повторите вход через ${minutesRu(minutes)}.`,
  },

  home: {
    signedInAs: (username: string) => `Вы вошли как ${username}.`,
    adminBadge: 'Администратор',
    adminLink: 'Управление курсами',
  },

  // The two Languages taught. Russian is the interface and is never one of them,
  // which is why it is not here.
  languages: {
    en: 'Английский',
    tj: 'Таджикский',
  } as Record<string, string>,

  admin: {
    title: 'Управление курсами',
    coursesTitle: 'Все курсы',
    // Reachable before any Course exists, and says so rather than showing an
    // empty list that reads like a fault.
    noCourses: 'Курсов пока нет.',
    lessonsTitle: 'Уроки',
    noLessons: 'В этом курсе пока нет уроков.',
    exerciseCount: (n: number) => `${n} ${plural(n, 'упражнение', 'упражнения', 'упражнений')}`,
    graderModel: (model: string) => `Проверяющий: ${model}`,
    published: 'Опубликован',
    unpublishedChanges: 'Есть неопубликованные изменения',
    // Never published at all: no student has ever seen this Lesson, and it is
    // not in the course they read.
    draft: 'Черновик — студенты его не видят',
    healthLink: 'Проверка Проверяющего',
    back: 'К управлению курсами',
    home: 'На главную',

    // Creating a Course.
    newCourseTitle: 'Новый курс',
    courseTitleField: 'Название курса',
    languageField: 'Язык курса',
    levelField: 'Уровень по CEFR',
    // A Course is fixed at one level for its whole duration, so this is asked
    // once and never again.
    levelHint: 'Уровень задаётся один раз и действует для всего курса.',
    graderModelField: 'Модель Проверяющего',
    graderModelHint:
      'Подставляется по языку курса: английский — Sonnet 5, таджикский — Opus 5. Можно изменить.',
    createCourse: 'Создать курс',
    creatingCourse: 'Создание курса…',
    courseCreated: 'Курс создан.',

    // Creating and ordering Lessons.
    newLessonTitle: 'Новый урок',
    lessonTitleField: 'Название урока',
    lessonStartsAsDraft:
      'Урок создаётся черновиком: студенты увидят его только после публикации.',
    createLesson: 'Добавить урок',
    creatingLesson: 'Добавление урока…',
    lessonCreated: 'Урок добавлен. Откройте его, чтобы написать теорию и упражнения.',
    reordering: 'Сохранение порядка…',
    orderSaved: 'Порядок уроков сохранён.',

    // Enrollment.
    rosterTitle: 'Доступ к курсу',
    rosterHint:
      'Курс, на который никто не записан, не виден никому — включая того, кто его написал.',
    enroll: 'Записать на курс',
    enrolling: 'Запись…',
    enrolledAlready: 'Записан',
    enrolledNow: 'Студент записан на курс.',
    noStudents: 'Нет ни одного аккаунта.',

    // Every write in the section fails the same way, and says so the same way.
    writeFailed: 'Не удалось сохранить. Попробуйте ещё раз.',
  },

  // The refusals the authoring writes report, keyed by the stable code. Same
  // split as everywhere else: the code is what is checked, this is only what is
  // read, and a test asserts every code has exactly one entry here.
  authoringFaults: {
    course_title_empty: 'Заполните название курса.',
    language_unknown: 'Выберите язык курса: английский или таджикский.',
    level_unknown: 'Выберите уровень по CEFR.',
    // ADR 0002. The rule is stated rather than hidden behind «недоступно»,
    // because someone will reach for Haiku again and deserves to know why not.
    grader_model_forbidden:
      'Haiku не проверяет ответы ни на одном языке: он уверенно объясняет грамматику неверно. Выберите Sonnet 5 или Opus 5.',
    grader_model_unknown: 'Такой модели нет в списке. Выберите Sonnet 5 или Opus 5.',
    lesson_title_empty: 'Заполните название урока.',
    course_not_found: 'Курс не найден. Обновите страницу.',
    student_not_found: 'Студент не найден. Обновите страницу.',
    order_mismatch: 'Порядок уроков устарел. Обновите страницу и попробуйте снова.',
  },

  health: {
    title: 'Проверка Проверяющего',
    // Says plainly what pressing the button costs: one real graded call.
    explanation:
      'Отправляет один настоящий запрос Проверяющему с заранее известным ответом и показывает, отвечает ли он.',
    run: 'Запустить проверку',
    running: 'Идёт проверка…',
    healthy: 'Проверяющий отвечает.',
    unhealthy: 'Проверяющий не отвечает.',
    tookMs: (ms: number) => `Запрос занял ${(ms / 1000).toFixed(1)} с.`,
    reason: (reason: string) => `Причина: ${reason}`,
    // ADR 0001 records that a credentials failure does not present as an auth
    // error, so this is phrased as a guess and must stay phrased as a guess.
    likelyCredentials:
      'Похоже на проблему с доступом к учётным данным Claude. Это предположение, а не точный диагноз: проверьте, что служба запущена от пользователя dykmoby и что HOME указывает на /home/dykmoby.',
    // Measured on 2026-08-20: without the proxy the call fails with a 403 that
    // reads like an authentication problem and is not one.
    likelyEgress:
      'Учётные данные на месте, но запрос не вышел наружу. Это предположение, а не точный диагноз: скорее всего служба не видит прокси — проверьте HTTP_PROXY и HTTPS_PROXY в /etc/language-learner.env и что прокси на 127.0.0.1:7890 запущен.',
    forbidden: 'Доступ только для администратора.',
  },

  courses: {
    title: 'Мои курсы',
    none: 'Вас пока не записали ни на один курс.',
    lessonCount: (n: number) => `${n} ${plural(n, 'урок', 'урока', 'уроков')}`,
  },

  course: {
    lessonsTitle: 'Уроки',
    locked: 'Откроется после предыдущего урока',
    complete: 'Пройден',
    inProgress: 'В работе',
    lockedRefusal: 'Этот урок ещё закрыт. Сначала пройдите предыдущий.',
    back: 'К курсам',
  },

  lesson: {
    theory: 'Теория',
    toPractice: 'Перейти к упражнениям',
    backToCourse: 'К списку уроков',
    grammarFocus: 'Тема урока',
  },

  practice: {
    title: 'Упражнения',
    position: (n: number, total: number) => `Упражнение ${n} из ${total}`,
    // The progress bar states, spelled out for a screen reader as well as shown.
    doneCount: (n: number) => `Пройдено: ${n}`,
    withHelpCount: (n: number) => `С подсказкой: ${n}`,
    answer: 'Ваш ответ',
    chooseOption: 'Выберите вариант',
    buildSentence: 'Нажимайте на слова, чтобы составить предложение',
    clear: 'Очистить',
    submit: 'Проверить',
    // The Student waits roughly three seconds before the first token arrives.
    // This says what is happening in that gap rather than spinning at them.
    checking: 'Проверяющий читает ваш ответ…',
    emptyAnswer: 'Сначала напишите ответ.',
    next: 'Дальше',
    correct: 'Верно!',
    partiallyCorrect: 'Почти верно',
    incorrect: 'Неверно',
    corrected: 'Правильно так',
    errorsTitle: 'Что не так',
    // design.md § Failure behaviour: never rendered as a wrong answer, and it
    // must not read like one either.
    gradingFailed:
      'Не удалось проверить ответ — это сбой проверки, а не ошибка в вашем ответе. Попытка не засчитана, попробуйте ещё раз.',
    reveal: 'Показать ответ',
    revealHint: 'После трёх неудачных попыток можно посмотреть правильный ответ.',
    revealed: 'Ответ показан',
    // Seen only by a stale tab: the Exercise moved on while it was open.
    alreadyComplete: 'Это упражнение уже пройдено. Обновите страницу.',
    notCurrent: 'Упражнения проходятся по порядку. Обновите страницу.',
    lessonComplete: 'Урок пройден!',
    nextLesson: 'Следующий урок',
    nextLessonUnlocked: 'Следующий урок открыт.',
    courseComplete: 'Это был последний урок курса.',
    empty: 'В этом уроке пока нет упражнений.',
  },

  // design.md § Error Type enum — stable in storage, Russian label at display
  // time. Only the label ever changes, which is why nothing here is persisted.
  //
  // ⚠️ The Tajik half of this enum is unreviewed by a Tajik speaker
  // (design.md § Open risks). Writing Russian labels for it did not review it.
  errorTypes: {
    // Core, both Languages
    word_order: 'Порядок слов',
    spelling: 'Орфография',
    punctuation: 'Пунктуация',
    capitalization: 'Заглавная буква',
    vocabulary_choice: 'Выбор слова',
    missing_word: 'Пропущено слово',
    extra_word: 'Лишнее слово',
    meaning_mismatch: 'Смысл не передан',
    register_style: 'Стиль речи',

    // English
    article: 'Артикль',
    tense: 'Время глагола',
    irregular_verb: 'Неправильный глагол',
    subject_verb_agreement: 'Согласование подлежащего и сказуемого',
    preposition: 'Предлог',
    plural_form: 'Множественное число',
    countability: 'Исчисляемость',
    modal_verb: 'Модальный глагол',
    conditional: 'Условное предложение',
    gerund_vs_infinitive: 'Герундий или инфинитив',
    phrasal_verb: 'Фразовый глагол',

    // Tajik. Some of these read the same as their English counterparts —
    // plural_form_tj and plural_form are both «Множественное число» — which is
    // correct: they are the same grammatical idea in two enums, kept apart
    // because a Course is in one Language and never sees both. A histogram
    // across Languages (step 7) must therefore group by Language, not by label.
    verb_agreement: 'Согласование глагола',
    izofat: 'Изафет',
    definiteness_ro: 'Показатель определённости -ро',
    pronoun_enclitic: 'Местоименная энклитика',
    plural_form_tj: 'Множественное число',
    preposition_tj: 'Предлог',
    compound_verb: 'Составной глагол',
    tense_tj: 'Время глагола',
  } as Record<string, string>,

  // design.md § Exercise Kinds — the names an Admin picks between. The stable
  // enum value is what is stored; this is only what is read.
  exerciseKinds: {
    composition: 'Сочинение',
    translation: 'Перевод',
    open_writing: 'Свободное письмо',
    fill_gap: 'Вставить пропущенное',
    multiple_choice: 'Выбор варианта',
    word_order: 'Порядок слов',
  } as Record<string, string>,

  // Which half of design.md § Exercise Kinds a Kind falls in. Shown on the form
  // because it is what decides whether the Reference Answer is context for a
  // model or the thing the answer is compared against.
  judgedBy: {
    grader: 'Ответ проверяет Проверяющий',
    deterministic: 'Ответ проверяется без Проверяющего, сравнением с принимаемыми ответами',
  },

  // design.md § Exercise Kinds, read by an Admin filling in an authoring form.
  // Keyed by the stable fault code the validity rules report — the code is what
  // is checked and stored, this is only what is read, and a test asserts every
  // code has exactly one entry here.
  exerciseFaults: {
    prompt_empty: 'Заполните формулировку задания.',
    reference_answer_empty: 'Заполните эталонный ответ.',
    accepted_answers_required:
      'Это упражнение проверяется без Проверяющего, поэтому нужен хотя бы один принимаемый ответ.',
    too_many_fragments:
      'Слишком много фрагментов: в задании на порядок слов их должно быть не больше двенадцати.',
    accepted_answers_not_allowed:
      'Этот ответ проверяет Проверяющий — список принимаемых ответов здесь не используется. Удалите его.',
    choices_required: 'Нужно не меньше двух вариантов: из одного выбирать нечего.',
    choices_not_allowed: 'У этого вида упражнений нет вариантов для показа. Удалите их.',
    accepted_answer_not_a_choice:
      'Такого варианта нет среди предложенных — студент не сможет его выбрать.',
    reference_answer_not_a_choice:
      'Эталонного ответа нет среди вариантов: при показе ответа студент увидит то, чего ему не предлагали.',
    fragments_do_not_build_answer:
      'Из предложенных фрагментов такой порядок не собирается: каждый фрагмент должен быть использован ровно один раз.',
    duplicate_accepted_answers:
      'Этот ответ не отличается от другого принимаемого: при проверке они совпадают.',
  },

  draft: {
    title: 'Черновик урока',
    // Says plainly what the two buttons do, because the whole design rests on
    // them being different acts.
    explanation:
      'Сохранение создаёт новый черновик — студент по-прежнему видит опубликованный урок. Опубликовать нужно отдельно.',
    lessonTitle: 'Название урока',
    grammarFocus: 'Тема урока',
    grammarFocusHint: 'Эту строку получает Проверяющий при каждой проверке ответа.',
    theory: 'Теория (Markdown)',
    preview: 'Предпросмотр',
    save: 'Сохранить черновик',
    saving: 'Сохранение…',
    saved: 'Черновик сохранён. Студент пока видит опубликованный урок.',
    publish: 'Опубликовать',
    publishing: 'Публикация…',
    publishedNow: 'Урок опубликован. Студенты видят обновлённый урок.',
    // The Draft is saved; only the publish was refused, and saying so is the
    // difference between "your work is safe" and "your work is gone".
    publishRefused: 'Опубликовать нельзя. Черновик сохранён — исправьте и попробуйте снова.',
    saveFailed: 'Не удалось сохранить черновик. Попробуйте ещё раз.',
    // An incoherent Exercise never reaches a Draft, so this refusal is about the
    // Exercises and says so: the theory and the title are still in the form.
    saveRefused: 'Черновик не сохранён: исправьте упражнения ниже.',

    // Images in Theory.
    imageUpload: 'Вставить изображение',
    imageUploading: 'Загрузка изображения…',
    imageUploadHint: (megabytes: number) =>
      `PNG, JPEG, GIF или WebP, не больше ${megabytes} МБ. Разметка вставится там, где стоит курсор.`,
    imageUploadFailed: 'Не удалось загрузить изображение. Попробуйте ещё раз.',
    imageAlt: 'изображение',

    // Draft history.
    historyTitle: 'История черновиков',
    historyExplanation:
      'Каждое сохранение создаёт новый черновик, и ни один не удаляется. Восстановление добавляет копию выбранного черновика в конец истории — все предыдущие остаются на месте.',
    historyEmpty: 'Черновиков пока нет: урок ещё ни разу не сохраняли.',
    historyEntry: (position: number) => `Черновик ${position}`,
    historyAuthor: (username: string) => `автор: ${username}`,
    historyAuthorUnknown: 'автор неизвестен',
    historyPublished: 'опубликован',
    historySelected: 'Показан сейчас',
    historyShow: 'Показать',
    restore: 'Восстановить этот черновик',
    restoring: 'Восстановление…',
    restored: 'Черновик восстановлен — он добавлен в конец истории как новый. Студенты по-прежнему видят опубликованный урок: чтобы это изменить, опубликуйте отдельно.',
    restoreFailed: 'Не удалось восстановить черновик. Попробуйте ещё раз.',
    historyTheory: 'Теория этого черновика',
    historyExercises: 'Упражнения этого черновика',
    historyNoExercises: 'В этом черновике упражнений нет.',
    backToDraft: 'К черновику',
    nothingToPublish: 'Публиковать нечего: черновик совпадает с опубликованным уроком.',
    saveFirst: 'Сначала сохраните черновик — публикуется только сохранённое.',
    unsaved: 'Есть несохранённые правки.',
    alreadyPublished: 'Этот черновик уже опубликован. Обновите страницу.',
    unpublishedChanges: 'Черновик новее опубликованного урока.',
    upToDate: 'Опубликованный урок совпадает с черновиком.',
    exerciseCount: (n: number) => `${n} ${plural(n, 'упражнение', 'упражнения', 'упражнений')} в практике`,
    // The Exercise forms are not built yet; saying so is better than an Admin
    // concluding the Exercises were lost.
    // The Exercise forms.
    exercisesTitle: 'Упражнения',
    noExercises: 'В этом уроке пока нет упражнений. Урок без упражнений публикуется, но практики в нём не будет.',
    exerciseAt: (position: number) => `Упражнение ${position}`,
    exerciseKind: 'Вид упражнения',
    addExercise: 'Добавить упражнение',
    prompt: 'Формулировка задания',
    referenceAnswer: 'Эталонный ответ',
    referenceAnswerGraderHint:
      'Проверяющий получает его как образец при каждой проверке. Ошибка здесь тихо портит проверку всех ответов на это упражнение.',
    referenceAnswerRevealHint: 'Его же увидит студент, если попросит показать ответ.',
    acceptedAnswers: 'Принимаемые ответы — по одному в строке',
    acceptedOrders: 'Принимаемые порядки — по одному в строке',
    caseSensitive: 'Различать заглавные и строчные буквы',
    caseSensitiveHint:
      'Нужно там, где важна именно форма записи. В остальных случаях оставьте выключенным.',
    choices: 'Варианты, которые видит студент',
    fragments: 'Фрагменты, из которых студент собирает предложение',
    addChoice: 'Добавить вариант',
    addFragment: 'Добавить фрагмент',
    removeChoice: 'Убрать',
    correctChoice: 'Принимается',
    referenceChoice: 'Эталон',
    // Shown before anything is clicked, so an Admin knows which Exercises carry
    // a Student's work while they are still deciding what to change.
    hasSubmissions: (n: number) =>
      `На это упражнение уже ${plural(n, 'дан', 'дано', 'дано')} ${n} ${plural(n, 'ответ', 'ответа', 'ответов')}.`,
    // Removing an Exercise cascades to every Submission made against it, and a
    // Student's work is not something to throw away without saying so.
    removeExercise: 'Удалить упражнение',
    removeWithSubmissions: (n: number) =>
      `У этого упражнения уже есть ${n} ${plural(n, 'ответ', 'ответа', 'ответов')} студентов. Удаление упражнения удалит и их — это нельзя отменить.`,
    confirmRemove: 'Всё равно удалить',
    cancelRemove: 'Не удалять',
    // Changing a Kind clears the fields the new Kind cannot use, and that
    // clearing is correct — carrying them across produced an Exercise whose
    // accepted answer could not tile its fragments. What was wrong is that it
    // happened silently: discarding an author's own typing deserves the same
    // warning as discarding a Student's answers, one control away on this form.
    //
    // A count, not a list of field names: what an author needs to decide is how
    // much of their typing is about to go.
    kindChangeDiscards: (n: number, kind: string) =>
      `Смена вида на «${kind}» очистит ${n} ${plural(n, 'заполненное поле', 'заполненных поля', 'заполненных полей')}: этот вид упражнения их не использует.`,
    confirmKindChange: 'Всё равно сменить',
    cancelKindChange: 'Оставить вид как был',
    neverPublished: 'Этот урок ещё ни разу не опубликован — студенты его не видят.',
    // What made the Draft on the screen. Until Generation existed, every Draft
    // was typed by a person and saying so would have been noise; now it is the
    // only thing distinguishing a Draft an Admin wrote every word of from one
    // Claude produced thirty seconds ago.
    madeBy: (origin: string) => `Этот черновик — ${origin}.`,
    // A count, and the specific thing it points at. The validity rules cannot
    // help here: an эталонный ответ that is fluent, plausible and wrong passes
    // every rule there is. A person can catch it, but only if told there is
    // something to look at.
    publishUnreviewed: (n: number) =>
      `В этом черновике ${n} ${plural(n, 'упражнение', 'упражнения', 'упражнений')} с эталонным ответом, который не менялся с тех пор, как его написал Claude. Проверяющий получает эталонный ответ при каждой проверке: ошибка в нём тихо портит проверку всех ответов на это упражнение.`,
    confirmPublish: 'Всё равно опубликовать',
    cancelPublish: 'Не публиковать — сначала проверю',
    faultAt: (position: number) => `Упражнение ${position}:`,
    backToCourse: 'К курсу',
  },

  // Why an upload was refused, keyed by the stable code the endpoint reports.
  // Same split as everywhere else, and a test asserts every code has exactly one
  // entry here.
  uploadRefusals: {
    too_large: 'Файл слишком большой. Уменьшите его и попробуйте снова.',
    wrong_type: 'Это не изображение из разрешённых: PNG, JPEG, GIF или WebP.',
  },

  // What made a Draft, read on the history screen. Recorded when it is saved
  // rather than guessed afterwards — by step 5 most versions will not have been
  // typed by a person.
  draftOrigins: {
    manual: 'ручная правка',
    restore: 'восстановление черновика',
    generation: 'генерация',
    refinement: 'доработка с Claude',
  } as Record<string, string>,

  // The faults that are about the Lesson rather than one of its Exercises.
  // Split from exerciseFaults because they are reported in different places on
  // the form, and joined again by faultMessage below.
  documentFaults: {
    title_empty: 'Заполните название урока.',
    grammar_focus_empty:
      'Заполните тему урока: её получает Проверяющий при каждой проверке ответа.',
    theory_empty: 'Заполните теорию урока.',
    duplicate_exercise_id:
      'Это упражнение указано в черновике дважды. Оставьте одно.',
  },

  // design.md § Authoring — the Admin describes a Lesson and Claude writes it.
  generation: {
    title: 'Сгенерировать урок',
    // Says plainly where the result lands, because that is the whole safeguard:
    // a сгенерированный урок публикуется только отдельным решением человека.
    explanation:
      'Claude напишет урок целиком и сохранит его как новый черновик. Студенты не увидят его, пока вы не опубликуете. Предыдущие черновики остаются на месте.',
    topic: 'Тема урока',
    topicHint: 'Чем конкретнее, тем лучше: «Present Simple в вопросах» вместо «времена».',
    vocabulary: 'Лексика — по одному слову в строке',
    vocabularyHint: 'Эти слова урок должен объяснить и отработать.',
    exerciseCount: 'Сколько упражнений',
    exerciseCountHint: (min: number, max: number) => `От ${min} до ${max}.`,
    kindMix: 'Сколько упражнений каждого вида',
    // design.md § Authoring: the control exists because generation over-produces
    // multiple choice — the cheapest Kind to write and the least useful to learn
    // from. Saying so is why an Admin bothers to fill it in.
    kindMixHint:
      'Оставьте нули, чтобы Claude выбрал сам. Без этого он почти всегда пишет одни «выборы варианта»: их проще всего составить и меньше всего пользы от них при обучении. Сумма не должна превышать общее число упражнений.',
    continueFrom: 'Продолжить после урока',
    continueFromNone: 'Не продолжать — самостоятельный урок',
    // Published only, and the reason is worth stating: continuity is with what
    // the Student has actually worked through, not with what an Admin has drafted.
    continueFromHint:
      'В список попадают только опубликованные уроки: смысл в том, чтобы опираться на пройденное студентом.',
    wishes: 'Дополнительные пожелания',
    wishesHint: 'Свободным текстом: тон, темы примеров, чего избегать.',
    model: 'Модель',
    effort: 'Усилие',
    effortDefault: 'По умолчанию',
    effortHint:
      'Чем выше, тем дольше и тщательнее. «Низкое» — быстрый черновик, «Максимальное» — несколько минут.',
    generate: 'Сгенерировать',
    generating: 'Claude пишет урок…',
    theoryArriving: 'Теория, как она пишется',
    cancel: 'Отменить генерацию',
    // Nothing was written, and saying so is the difference between "ничего не
    // произошло" and "непонятно, что теперь в черновике".
    cancelled: 'Генерация отменена. Черновик не изменился.',
    done: 'Урок сгенерирован и сохранён как черновик. Проверьте его и опубликуйте, если всё верно.',
    failed: 'Не удалось сгенерировать урок. Черновик не изменился — исходные данные остались в форме, попробуйте ещё раз.',
    timedOut: 'Claude не ответил вовремя. Черновик не изменился — попробуйте ещё раз, можно с меньшим усилием.',
    // Refused rather than stored: an incoherent Exercise must never попасть в
    // черновик. Which Exercises are at fault is listed beneath.
    refusedInvalid:
      'Claude вернул урок с испорченными упражнениями, поэтому он не сохранён. Черновик не изменился.',
    // A difference from what was ordered, not a fault: the Draft is stored.
    mismatchTitle: 'Не совпало с заказом',
    mismatchHint: 'Черновик всё равно сохранён — поправьте вручную или сгенерируйте заново.',
    countMismatch: (asked: number, produced: number) =>
      `Заказано упражнений: ${asked}, пришло: ${produced}.`,
    kindMismatch: (kind: string, asked: number, produced: number) =>
      `«${kind}»: заказано ${asked}, пришло ${produced}.`,
  },

  // design.md § Authoring — the ongoing conversation with Claude over a Draft.
  refinement: {
    title: 'Доработка с Claude',
    explanation:
      'Скажите, что изменить, и Claude вернёт весь урок целиком с этой правкой. Каждый ответ — новый черновик; предыдущие остаются. Ваши правки руками тоже уходят в запрос, так что править и обсуждать можно вперемешку.',
    // The conversation is over a Draft, and there is nothing to converse about
    // until one exists.
    saveFirst: 'Сначала сохраните черновик — разговор идёт про сохранённую версию урока.',
    empty: 'Разговора об этом уроке ещё не было.',
    asked: 'Вы попросили:',
    message: 'Что изменить',
    messageHint:
      'Например: «третье упражнение слишком лёгкое», «добавь два задания на прошедшее время», «в теории артикль объяснён дважды».',
    send: 'Отправить',
    sending: 'Claude переписывает урок…',
    // The document travels with every turn, so the Lesson is never lost — only
    // the thread. Saying which is the difference between a warning and a scare.
    threadLost:
      'Прежний разговор продолжить не удалось, поэтому начат новый — Claude видит текущий урок, но не помнит предыдущие просьбы. Повторите важное в следующем сообщении.',

    // A Refinement fails the same way a Generation does, and must say so in its
    // own words. CONTEXT.md keeps Generation and Refinement apart as terms;
    // telling an Admin whose доработка timed out that «не удалось сгенерировать
    // урок» names the wrong act entirely.
    cancel: 'Отменить',
    cancelled: 'Доработка отменена. Черновик не изменился.',
    failed: 'Не удалось доработать урок. Черновик не изменился — ваш запрос остался в поле, попробуйте ещё раз.',
    timedOut: 'Claude не ответил вовремя. Черновик не изменился — попробуйте ещё раз, можно с меньшим усилием.',
    refusedInvalid:
      'Claude вернул урок с испорченными упражнениями, поэтому он не сохранён. Черновик не изменился.',
  },

  // How much reasoning Claude applies during Generation, chosen per request by
  // the Admin. The stable value is what travels; this is only what is read.
  efforts: {
    low: 'Низкое',
    medium: 'Среднее',
    high: 'Высокое',
    xhigh: 'Очень высокое',
    max: 'Максимальное',
  } as Record<string, string>,

  // Why a Generation could not be asked for, and why what came back was not a
  // Lesson. Same split as everywhere else: the code is what is checked, this is
  // only what is read, and a test asserts every code has exactly one entry.
  //
  // Every refusal says the Draft did not change. design.md § Authoring: a
  // failure must never look like content, and an Admin must never be left unsure
  // whether what they are reading came from Claude or was already on the screen.
  generationFaults: {
    topic_empty: 'Опишите тему урока — без неё генерировать нечего.',
    exercise_count_out_of_range: 'Столько упражнений в одном уроке не бывает. Укажите другое число.',
    kind_mix_exceeds_count:
      'Видов упражнений заказано больше, чем упражнений в уроке. Уменьшите одно из чисел.',
    message_empty: 'Напишите, что нужно изменить в уроке.',
    no_document: 'Claude не вернул урок. Черновик не изменился.',
    field_missing: 'В уроке, который вернул Claude, не хватает обязательной части. Черновик не изменился.',
    unknown_exercise_kind:
      'Claude предложил вид упражнения, которого в системе нет. Черновик не изменился.',
    malformed_exercise:
      'Одно из упражнений заполнено так, что его нельзя прочитать. Черновик не изменился.',
  },

  errors: {
    notFound: 'Страница не найдена.',
    serverError: 'Что-то пошло не так.',
  },
} as const;

// An Error Type the enum does not know about is a contract violation the Grader
// module already reports; here it is simply shown as it came, because dropping
// the Error entirely would hide a real fault from the Student.
export function errorTypeLabel(type: string): string {
  return ru.errorTypes[type] ?? type;
}

// A fault code is about the Lesson, about one of its Exercises, or about a write
// in the Admin section, and the form that shows it does not care which. An
// unknown code is shown as it came, for the same reason an unknown Error Type
// is: dropping it would hide a real fault from the person who has to fix it.
export function faultMessage(code: string): string {
  const lessonLevel: Record<string, string> = ru.documentFaults;
  const exerciseLevel: Record<string, string> = ru.exerciseFaults;
  const authoring: Record<string, string> = ru.authoringFaults;
  const uploads: Record<string, string> = ru.uploadRefusals;
  const generation: Record<string, string> = ru.generationFaults;
  return lessonLevel[code] ?? exerciseLevel[code] ?? authoring[code]
    ?? uploads[code] ?? generation[code] ?? code;
}
