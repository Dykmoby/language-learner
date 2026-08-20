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
    healthLink: 'Проверка Проверяющего',
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
