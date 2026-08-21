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
    edit: 'Редактировать',
    healthLink: 'Проверка Проверяющего',
    back: 'К управлению курсами',
    home: 'На главную',
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

  // design.md § Exercise Kinds, read by an Admin filling in an authoring form.
  // Keyed by the stable fault code the validity rules report — the code is what
  // is checked and stored, this is only what is read, and a test asserts every
  // code has exactly one entry here.
  exerciseFaults: {
    prompt_empty: 'Заполните формулировку задания.',
    reference_answer_empty: 'Заполните эталонный ответ.',
    accepted_answers_required:
      'Это упражнение проверяется без Проверяющего, поэтому нужен хотя бы один принимаемый ответ.',
    accepted_answers_not_allowed:
      'Этот ответ проверяет Проверяющий — список принимаемых ответов здесь не используется. Удалите его.',
    choices_required: 'Нужно не меньше двух вариантов: из одного выбирать нечего.',
    choices_not_allowed: 'У этого типа упражнения нет вариантов для показа. Удалите их.',
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
      'Сохранение создаёт новую версию черновика — студент по-прежнему видит опубликованный урок. Опубликовать нужно отдельно.',
    lessonTitle: 'Название урока',
    grammarFocus: 'Тема урока',
    grammarFocusHint: 'Эту строку получает Проверяющий при каждой проверке ответа.',
    theory: 'Теория (Markdown)',
    preview: 'Предпросмотр',
    save: 'Сохранить черновик',
    saving: 'Сохранение…',
    saved: 'Черновик сохранён. Студент пока видит опубликованную версию.',
    publish: 'Опубликовать',
    publishing: 'Публикация…',
    publishedNow: 'Урок опубликован. Студенты видят новую версию.',
    // The Draft is saved; only the publish was refused, and saying so is the
    // difference between "your work is safe" and "your work is gone".
    publishRefused: 'Опубликовать нельзя. Черновик сохранён — исправьте и попробуйте снова.',
    saveFailed: 'Не удалось сохранить черновик. Попробуйте ещё раз.',
    nothingToPublish: 'Нет несохранённых изменений для публикации.',
    unpublishedChanges: 'Черновик новее опубликованного урока.',
    upToDate: 'Опубликованный урок совпадает с черновиком.',
    exerciseCount: (n: number) => `${n} ${plural(n, 'упражнение', 'упражнения', 'упражнений')} в практике`,
    // The Exercise forms are not built yet; saying so is better than an Admin
    // concluding the Exercises were lost.
    exercisesNotEditable: 'Упражнения пока редактируются только через сид-скрипт.',
    faultAt: (position: number) => `Упражнение ${position}:`,
    backToCourse: 'К курсу',
  },

  // The faults that are about the Lesson rather than one of its Exercises.
  // Split from exerciseFaults because they are reported in different places on
  // the form, and joined again by faultMessage below.
  documentFaults: {
    title_empty: 'Заполните название урока.',
    grammar_focus_empty:
      'Заполните тему урока: её получает Проверяющий при каждой проверке ответа.',
    theory_empty: 'Заполните теорию урока.',
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

// A fault code is either about the Lesson or about one of its Exercises, and the
// form that shows it does not care which. An unknown code is shown as it came,
// for the same reason an unknown Error Type is: dropping it would hide a real
// fault from the person who has to fix it.
export function faultMessage(code: string): string {
  const documented: Record<string, string> = ru.documentFaults;
  const exercise: Record<string, string> = ru.exerciseFaults;
  return documented[code] ?? exercise[code] ?? code;
}
