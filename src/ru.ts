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

  // Dates are formatted by the browser rather than written out here, but which
  // locale they are formatted in is still a fact about the interface language.
  locale: 'ru-RU',

  common: {
    signOut: 'Выйти',
    loading: 'Загрузка…',
    // The same act on both things an Admin reorders — the Lessons of a Course
    // and the Exercises of a Practice. One definition, so a translator sees it
    // once and the two screens cannot end up saying different words for it.
    moveUp: 'Выше',
    moveDown: 'Ниже',
    // The way back out of a confirmation. One definition, because a screen that
    // asks twice before doing something irreversible should offer the same word
    // for "no" every time it asks.
    cancel: 'Отмена',
  },

  // The six states a judgement can be in, named once.
  //
  // design.md § Interface leans on colour to carry these, so each is told apart
  // three ways over — by hue, by the shape of its rail, and by these words. Any
  // one of the three has to be enough on its own: the words are what survive a
  // monochrome screen, and the rail is what survives a reader who cannot
  // separate two of the hues.
  //
  // They are short because they are labels rather than sentences. Where a screen
  // needs to say more — the Practice congratulating a step, the retry message
  // after a failed grading — it has its own longer string, and that string is
  // additional to this one rather than instead of it.
  states: {
    correct: 'Верно',
    partial: 'Частично верно',
    incorrect: 'Неверно',
    // Completed With Help: complete, and deliberately not dressed as unaided.
    help: 'С подсказкой',
    // Neither a pass nor a fail — it is a question about a judgement.
    disputed: 'Оспорено',
    // Not a fault of the answer. design.md § Failure behaviour: a failure must
    // never be rendered as a wrong answer, and this is the wording half of that.
    failed: 'Проверка не удалась',
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

  // Choosing your own password: the forced first change after an Admin handed
  // out a Temporary Password, and the voluntary one afterwards. One screen, and
  // the lead sentence is the only thing that tells the two apart.
  password: {
    title: 'Смена пароля',
    // Says why the rest of the application is not reachable, rather than leaving
    // a Student to discover it by trying.
    forcedLead:
      'Вам выдали временный пароль. Придумайте свой: пока вы этого не сделаете, остальные страницы закрыты.',
    voluntaryLead: 'Здесь можно сменить пароль на новый.',
    // The same field, named for what the Student is actually holding.
    temporaryField: 'Временный пароль',
    currentField: 'Текущий пароль',
    newField: 'Новый пароль',
    confirmField: 'Новый пароль ещё раз',
    // The number here is the one the rules enforce, and a test asserts the two
    // agree — a hint that promises a different limit from the one that refuses is
    // worse than no hint.
    lengthHint: 'Новый пароль — не короче 8 символов.',
    submit: 'Сменить пароль',
    changed: 'Пароль изменён.',
    onward: 'Продолжить',
    // Said before it happens rather than discovered afterwards on the other
    // device.
    otherSessionsHint:
      'После смены пароля вход на остальных устройствах перестанет действовать.',
  },

  // The header that wraps every signed-in screen.
  chrome: {
    navLabel: 'Навигация',
    admin: 'Управление курсами',
  },

  home: {
    signedInAs: (username: string) => `Вы вошли как ${username}.`,
    adminBadge: 'Администратор',
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

    // The Grader's Effort, per Course — issue #76, ADR 0007. The hint names the
    // cost out loud: raising it makes a Student wait, and the Admin choosing it
    // is not the person who waits.
    graderEffortField: 'Усилие Проверяющего',
    graderEffortHint:
      'Сколько рассуждения Проверяющий тратит на оценку. Чем выше, тем дольше студент ждёт проверки: на «Максимальном» одна проверка может идти несколько минут.',

    // The Course's own instruction for the Grader — issue #80, ADR 0008. The
    // screen states the precedence out loud: an Admin who does not know which of
    // the two texts wins will write one that contradicts the other and never
    // find out which was followed.
    graderInstructionTitle: 'Указания Проверяющему для этого курса',
    graderInstructionExplanation:
      'Общие указания действуют для всех курсов сразу, но курсы учат разному: строгость к заглавным буквам, нужная курсу по орфографии, мешает разговорному курсу.',
    graderInstructionPrecedence:
      'Проверяющий получает оба текста: сначала общий, потом этот. Там, где они расходятся, действует указание курса — оно точнее.',
    graderInstructionField: 'Указания для курса',
    graderInstructionHint: (max: number) =>
      `Обычный текст, не разметка. До ${max} символов. Пустое поле допустимо и ничего не меняет — именно с ним курс и создаётся.`,
    createCourse: 'Создать курс',
    creatingCourse: 'Создание курса…',
    courseCreated: 'Курс создан.',

    // The Course's settings — issue #75. A Course used to be created once and
    // then fixed, so a mistyped title stayed mistyped.
    settingsLink: 'Настройки курса',
    settingsTitle: 'Настройки курса',
    backToCourse: 'К курсу',
    saveSettings: 'Сохранить настройки',
    savingSettings: 'Сохранение…',
    settingsSaved: 'Настройки сохранены.',
    // Shown rather than offered. Stated as a fact about the Course, because a
    // greyed-out control reads as "not right now" and these two are never
    // editable at all.
    languageFixed: (language: string) => `Язык курса: ${language}`,
    levelFixed: (level: string) => `Уровень по CEFR: ${level}`,
    // The reason, not just the rule: an Admin who is told «нельзя» without it
    // will assume the screen is unfinished.
    fixedFactsHint:
      'Язык и уровень задаются при создании курса и потом не меняются: на них написан каждый урок и каждое упражнение, а смена языка оставила бы курс, содержание которого на одном языке, а Проверяющий проверяет на другом.',
    // Says the one thing an Admin cannot see for themselves: the change takes
    // effect on the next answer, with nothing to restart and nothing to wait for.
    graderModelChangeHint:
      'Новая модель проверяет следующий отправленный ответ — перезапускать ничего не нужно.',

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
    // Taking the Enrollment away. The message says what was *not* removed,
    // because that is the part nobody would assume.
    withdraw: 'Убрать с курса',
    withdrawing: 'Удаление с курса…',
    withdrawnNow: 'Студент убран с курса. Его ответы в курсе сохранены.',

    // Accounts: a screen of its own, reached from the dashboard.
    accountsLink: 'Аккаунты',
    accountsTitle: 'Аккаунты',
    // The list, under the screen's own title. Named separately rather than
    // repeating the title as its own first heading.
    accountsListTitle: 'Все аккаунты',
    accountsHint:
      'Аккаунты создаются только здесь: зарегистрироваться самостоятельно нельзя.',
    enrollmentCount: (n: number) => `${n} ${plural(n, 'курс', 'курса', 'курсов')}`,
    accountCreatedAt: (when: string) => `создан ${when}`,
    temporaryPasswordStanding:
      'Временный пароль ещё не сменён: пока это не сделано, студент не может открыть ни одного урока.',

    newAccountTitle: 'Новый студент',
    newAccountHint:
      'Новый аккаунт — всегда студент без прав администратора. Пароль система придумает сама и покажет один раз.',
    usernameField: 'Имя пользователя',
    createAccount: 'Создать аккаунт',
    creatingAccount: 'Создание аккаунта…',

    // The Temporary Password panel. It exists to be read out and then forgotten
    // by the screen, and every line of it says so.
    temporaryPasswordTitle: 'Временный пароль',
    temporaryPasswordFor: (username: string) => `Аккаунт «${username}» создан. Временный пароль:`,
    temporaryPasswordOnce:
      'Пароль показан один раз и нигде не сохраняется. Передайте его студенту сейчас — увидеть его снова будет негде.',
    temporaryPasswordRule:
      'При первом входе студент обязан сменить его на свой: до этого ни одна страница ему не откроется.',

    // Deleting an account. The warning names what goes with it, because nothing
    // in this application restores an account afterwards.
    deleteAccount: 'Удалить аккаунт',
    confirmDeleteAccount: 'Да, удалить',
    deletingAccount: 'Удаление…',
    deleteWarning: (username: string) =>
      `Вместе с аккаунтом «${username}» будут удалены все его ответы, попытки и споры. Это необратимо.`,
    accountDeleted: (username: string) => `Аккаунт «${username}» удалён.`,
    cannotDeleteSelfHint: 'Свой аккаунт удалить нельзя.',
    cannotDeleteAdminHint: 'Аккаунт администратора отсюда удалить нельзя.',

    // Tests, listed beside the Lessons of the same Course.
    testsTitle: 'Проверочные работы',
    noTests: 'В этом курсе пока нет проверочных работ.',
    newTestTitle: 'Новая проверочная работа',
    testTitleField: 'Название работы',
    testStartsAsDraft:
      'Работа создаётся черновиком: студенты увидят её только после публикации.',
    createTest: 'Добавить работу',
    creatingTest: 'Добавление работы…',

    // Every write in the section fails the same way, and says so the same way.
    writeFailed: 'Не удалось сохранить. Попробуйте ещё раз.',
  },

  // One Test, from an author's side. Kept apart from `draft` because the two acts
  // differ: a Lesson is saved into a new Draft and published from it, and a Test
  // has no Draft at all — saving changes what is there, and publishing only
  // decides whether a Student can see it.
  testAdmin: {
    title: 'Проверочная работа',
    explanation:
      'У работы нет черновиков: что сохранено, то и есть. Студенты видят работу только после публикации.',
    // design.md § Tests: a Test is a mirror, not a gate. Said on the screen
    // because an Admin deciding what to put in one should know it opens nothing.
    gatesNothing:
      'Работа ничего не открывает и не закрывает: уроки идут своим порядком независимо от неё.',
    titleField: 'Название работы',
    passThreshold: 'Порог прохождения, %',
    passThresholdHint:
      'Доля верных ответов, при которой работа считается пройденной. По умолчанию 80%.',
    save: 'Сохранить работу',
    saving: 'Сохранение…',
    saved: 'Работа сохранена.',
    saveFailed: 'Не удалось сохранить работу. Попробуйте ещё раз.',
    saveRefused: 'Работа не сохранена: исправьте упражнения ниже.',
    publish: 'Опубликовать',
    publishing: 'Публикация…',
    published: 'Опубликована',
    unpublished: 'Черновик — студенты её не видят',
    publishedNow: 'Работа опубликована. Студенты видят её в курсе.',
    publishRefused: 'Опубликовать нельзя: исправьте то, что ниже.',
    // Publishing writes nothing but a flag, so what goes live is what was saved —
    // not what is on the screen.
    publishAfterSave: 'Сначала сохраните изменения: публикуется сохранённая работа.',
    alreadyPublished: 'Работа уже опубликована. Обновите страницу.',
    backToCourse: 'К курсу',
  },

  // Why a Test could not be saved or published, keyed by the stable code. Same
  // split as everywhere else: the code is what is checked, this is only what is
  // read, and a test asserts every code has exactly one entry.
  testFaults: {
    test_title_empty: 'Заполните название работы.',
    pass_threshold_out_of_range: 'Порог прохождения — целое число от 1 до 100.',
    test_empty: 'В работе нет ни одного упражнения — публиковать нечего.',
    test_duplicate_exercise_id: 'Это упражнение указано в работе дважды. Оставьте одно.',
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
    // The bound is on the stored text, so an over-long instruction is refused
    // rather than trimmed on the way in and silently graded against.
    course_instruction_too_long: 'Указания для курса слишком длинные. Сократите текст.',
    lesson_title_empty: 'Заполните название урока.',
    course_not_found: 'Курс не найден. Обновите страницу.',
    student_not_found: 'Студент не найден. Обновите страницу.',
    order_mismatch: 'Порядок уроков устарел. Обновите страницу и попробуйте снова.',
  },

  // Why an account could not be made, removed, or given a new password — keyed
  // by the stable code, the same split as everywhere else. A test asserts every
  // code has exactly one entry here, and that the two numbers written into these
  // sentences are the two the rules actually enforce.
  accountFaults: {
    username_empty: 'Введите имя пользователя.',
    username_too_long: 'Имя пользователя длиннее 32 символов. Сократите его.',
    // Named for what actually goes wrong rather than for the rule: a space is
    // invisible in the list and invisible in the sign-in field, and the sign-in
    // screen deliberately never says which half was wrong.
    username_has_space:
      'В имени пользователя не должно быть пробелов: их не видно ни в списке, ни при входе.',
    username_taken: 'Такое имя пользователя уже занято. Выберите другое.',
    account_not_found: 'Аккаунт не найден. Обновите страницу.',
    cannot_delete_self: 'Свой собственный аккаунт удалить нельзя.',
    // The rule is stated rather than hidden behind «нельзя», because the reason
    // is the useful part: nothing in the interface can grant the role back.
    cannot_delete_admin:
      'Аккаунт администратора нельзя удалить из интерфейса: роль выдаётся скриптом на сервере, и вернуть её отсюда будет нечем.',
    password_too_short: 'Новый пароль короче 8 символов.',
    password_mismatch: 'Новый пароль и его повтор не совпадают.',
    password_unchanged: 'Новый пароль совпадает с текущим. Придумайте другой.',
    current_password_wrong: 'Текущий пароль введён неверно.',
  },

  // Issue #79 / ADR 0006 — the one block of the Grader's prompt an Admin edits.
  // The screen says what it is for and what it cannot touch, because an Admin
  // who does not know where the line is will eventually try to move it.
  guidance: {
    title: 'Указания Проверяющему',
    link: 'Указания Проверяющему',
    explanation:
      'Этот текст получает Проверяющий при каждой проверке — и в практике, и в проверочной работе. Здесь задаётся, насколько строго проверять, что считать несущественным и каким тоном писать студенту.',
    // The fixed skeleton, named plainly. ADR 0006 is the long version.
    fixedExplanation:
      'Формат ответа, список типов ошибок, правило про span и блок, ограждающий ответ студента, остаются в коде и отсюда не меняются: на них держатся разбор ответа и защита от подмены инструкций.',
    field: 'Указания',
    // Plain text, not markdown: this goes into a prompt, not onto a page.
    hint: (max: number) => `Обычный текст, не разметка. До ${max} символов. Пустое поле допустимо — тогда Проверяющий получает только формат ответа.`,
    save: 'Сохранить',
    saving: 'Сохранение…',
    saved: 'Сохранено.',
    restore: 'Вернуть исходный текст',
    restoring: 'Возвращение…',
    shipped: 'Сейчас действует текст, поставляемый с приложением.',
    editedBy: (who: string, when: string) => `Последнее изменение: ${who}, ${when}.`,
    // The account that made the edit has since been deleted. The edit still
    // stands — it is the application's text, not that person's.
    editedByUnknown: (when: string) => `Последнее изменение: ${when}. Автор удалён.`,
    // The Health Check runs through the real Grader path, so a broken edit shows
    // up there on its own. Said out loud so the Admin knows where to look.
    healthNote:
      'Проверка Проверяющего идёт через тот же путь, поэтому неудачная правка видна на ней сразу.',
    writeFailed: 'Не удалось сохранить. Попробуйте ещё раз.',
  },

  // Why the guidance was refused, keyed by the stable code — the same split as
  // every other fault dictionary. A test asserts every code has exactly one
  // entry here and that the dictionary invents none.
  guidanceFaults: {
    // The bound is on the stored text, so an over-long guidance is refused
    // rather than trimmed on the way in and silently graded against.
    guidance_too_long: 'Указания слишком длинные. Сократите текст.',
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
    // The third heuristic, and the one that is not a fault of this box at all:
    // the API said "not now". Named as itself so the Admin is not sent to check
    // credentials that are fine — the trap ADR 0001's egress heuristic exists to
    // avoid, met at the other end.
    likelyRateLimit:
      'Похоже, обращения к API временно ограничены: слишком много запросов сразу или исчерпан лимит подписки. Учётные данные и сеть здесь ни при чём — подождите и запустите проверку ещё раз.',
    forbidden: 'Доступ только для администратора.',

    // The dashboard's banner: the last recorded run, read rather than run again.
    // Rendering this page must never spend a Grader call.
    never: 'Проверка Проверяющего ещё ни разу не выполнялась.',
    // Not a failure, and not dressed as one: nobody has asked yet.
    neverHint: 'Пока неизвестно, отвечает ли Проверяющий.',
    // Old enough that it says nothing about now. Red, but red for its own reason.
    stale: 'Последняя проверка слишком старая.',
    staleHint:
      'То, что проверка прошла успешно когда-то, не значит, что Проверяющий отвечает сейчас. Похоже, проверка перестала выполняться по расписанию.',
    lastRunAt: (when: string) => `Последняя проверка: ${when}`,
    ranBy: {
      button: 'вручную',
      timer: 'по расписанию',
    } as Record<string, string>,
  },

  // Moving a Course between boxes: the file an Admin downloads, and the same
  // file read back. One dictionary for both halves, because an Admin meets them
  // as one feature and the words have to agree.
  transfer: {
    exportCourse: 'Скачать курс одним файлом',
    exportHint:
      'Опубликованные уроки, проверочные работы, принятые варианты ответов и картинки — в одном JSON-файле. Ответы студентов, аккаунты и черновики в него не попадают.',

    importTitle: 'Загрузить курс из файла',
    importHint:
      'Файл всегда создаёт новый курс: существующий не изменяется и не заменяется. Загрузите тот же файл дважды — получите два независимых курса.',
    importFile: 'Файл курса',
    importCourse: 'Загрузить курс',
    importing: 'Загрузка курса…',
    imported: (title: string) => `Курс «${title}» загружен.`,
    importedCounts: (lessons: number, tests: number, images: number) =>
      `Уроков: ${lessons}, проверочных работ: ${tests}, картинок: ${images}.`,
    openImported: 'Открыть курс',
    faultInLesson: (position: number) => `Урок ${position}:`,
    faultInTest: (position: number) => `Проверочная работа ${position}:`,
    // Said plainly, because a Course nobody is enrolled in is invisible to
    // everyone including the person who just imported it.
    importedNobodyEnrolled: 'На курс пока никто не записан — откройте его и запишите студентов.',
    importedMissingImages: (n: number) =>
      `Картинок не нашлось в файле: ${n}. Теория ссылается на них, но их придётся загрузить заново.`,
    importFailed: 'Не удалось загрузить файл. Попробуйте ещё раз.',
  },

  // Why a file was refused. Nothing is written until every one of these has
  // passed, so a refusal always means the database is untouched.
  importFaults: {
    not_json: 'Это не JSON-файл или он повреждён. Загрузите файл целиком.',
    not_an_export: 'Файл не похож на экспорт курса.',
    version_unknown:
      'Файл сделан другой версией приложения, и прочитать его нельзя. Обновите приложение или экспортируйте курс заново.',
    // The faults about the Course itself — a blank title, an unknown language or
    // level, a model that may not grade — are not repeated here. They are the
    // same codes the New Course form reports, with the same Russian, resolved
    // through `faultMessage` from `authoringFaults`.
    variants_misaligned:
      'В файле нарушено соответствие между упражнениями и принятыми вариантами ответов.',
    image_not_an_image: 'Одна из картинок в файле — не картинка. Файл не загружен.',
    image_too_large: 'Одна из картинок в файле больше допустимого размера. Файл не загружен.',
    file_too_large: 'Файл слишком большой.',
  } as Record<string, string>,

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
    disputedCount: (n: number) => `Оспорено: ${n}`,
    answer: 'Ваш ответ',
    // One sentence with three inputs in it: a screen reader announcing «Ваш
    // ответ» three times says nothing about which gap it is on.
    gapAt: (n: number) => `Пропуск ${n}`,
    chooseOption: 'Выберите вариант',
    buildSentence: 'Нажимайте на слова, чтобы составить предложение',
    clear: 'Очистить',
    submit: 'Проверить',
    // The Student waits roughly three seconds before the first token arrives.
    // This says what is happening in that gap rather than spinning at them.
    checking: 'Проверяющий читает ваш ответ…',
    // Issue #76 — a Course set to a high Effort is checked in minutes rather
    // than seconds, and the Student chose none of that. After about a minute the
    // wait stops looking like a stuck screen and says so.
    //
    // Phrased as a possibility, not as a diagnosis: this screen does not know the
    // Course's Effort, so a call that is genuinely hanging on a `low` Course must
    // not be told it is being examined more deeply. ADR 0001 draws the same line
    // for the health check's heuristics — a guess is written as a guess. What
    // does hold either way is the second sentence, so that is the one stated
    // flatly: a failed check never counts as an attempt.
    stillChecking:
      'Проверка идёт дольше обычного — так бывает, если для курса выбрано высокое усилие Проверяющего. Подождите: если проверка всё же сорвётся, попытка не засчитается.',
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
    // The same fact — nothing was judged — with the reason the Student can act
    // on. «Сейчас» is the whole difference: a failure that says «попробуйте ещё
    // раз» invites an immediate retry into the same wall, and one that says the
    // Проверяющий is busy asks for the pause that actually helps.
    gradingBusy:
      'Проверяющий сейчас перегружен — это не ошибка в вашем ответе. Попытка не засчитана, подождите немного и отправьте ответ ещё раз.',
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

  // CONTEXT.md § Dispute — an objection to a Verdict, in the Student's own words.
  // Deliberately never «жалоба»: a Dispute is not a complaint about the
  // application, and the word a Student reads is what tells them which of the two
  // this is.
  dispute: {
    offer: 'Не согласны с оценкой?',
    open: 'Оспорить оценку',
    commentLabel: 'Почему вы считаете свой ответ верным',
    commentPlaceholder: 'Например: так тоже говорят, я встречал этот оборот в учебнике.',
    submit: 'Отправить возражение',
    cancel: 'Отмена',
    sending: 'Отправляем…',
    // Both halves matter: the objection is recorded, and the Student is not
    // waiting for it. design.md § Progression unblocks progression at this moment.
    sent: 'Возражение отправлено. Преподаватель его посмотрит — можно продолжать, упражнение больше не задерживает.',
    // A Test gates nothing, so there is nothing here to unblock and saying there
    // was would be saying something false.
    sentInTest: 'Возражение отправлено. Преподаватель его посмотрит. Оценка за тест не меняется.',
    emptyComment: 'Напишите, почему вы считаете свой ответ верным.',
    tooLong: (limit: number) =>
      `Возражение слишком длинное — не больше ${limit} символов. Ничего не отправлено.`,
    already: 'Возражение по этому ответу уже отправлено.',
    notJudged: 'Этот ответ ещё не был оценён, поэтому оспаривать нечего.',
    // What the Student sees afterwards, on the progress bar and beside the answer.
    pending: 'На рассмотрении',
    upheld: 'Возражение принято',
    rejected: 'Оценка оставлена без изменений',
  },

  // The Admin's half: the queue, one Dispute reviewed, and the two decisions.
  disputeReview: {
    title: 'Возражения',
    link: 'Возражения',
    // On the Admin index, so the queue is not something to remember to look at.
    waiting: (n: number) => `Ждут решения: ${n}`,
    queueEmpty: 'Возражений, ожидающих решения, нет.',
    resolvedTitle: 'Рассмотренные',
    resolvedEmpty: 'Рассмотренных возражений пока нет.',
    from: (student: string, course: string) => `${student} · ${course}`,
    // Named so the Admin sees at a glance where the answer was written: a Test is
    // where a Student writes at greatest length with no Progressive Hint.
    inLesson: (title: string) => `Урок: ${title}`,
    inTest: (title: string) => `Тест: ${title}`,
    open: 'Рассмотреть',
    back: 'Ко всем возражениям',

    exerciseTitle: 'Упражнение',
    referenceAnswer: 'Эталонный ответ',
    acceptedTitle: 'Уже принимаются',
    acceptedNone: 'Дополнительных принимаемых ответов пока нет.',
    studentAnswer: 'Ответ студента',
    // The correction the Grader wrote, which since #81 the Student does not see
    // until their third failed attempt. It is stored on every attempt precisely
    // so that this screen can show it: a Verdict reviewed without the answer the
    // Grader thought was right is a Verdict reviewed with half the evidence.
    graderCorrected: 'Исправление Проверяющего',
    graderErrors: 'Что нашёл Проверяющий',
    graderNoErrors: 'Проверяющий не отметил ни одной ошибки.',
    verdict: 'Оценка',
    comment: 'Возражение студента',
    submittedAt: 'Отправлено',

    uphold: 'Принять возражение',
    // Says what pressing it does, because it does something irreversible to the
    // Exercise: the answer becomes context for every later Grader call.
    upholdHint: 'Ответ студента станет одним из принимаемых ответов этого упражнения.',
    reject: 'Оставить оценку',
    rejectHint: 'Оценка остаётся прежней. У студента ничего не отнимается.',

    variantAdded: 'Ответ добавлен к принимаемым.',
    // The honest answer where the answer was already accepted: nothing was added,
    // and saying one was would be saying something false.
    variantAlready: 'Такой ответ уже принимался — ничего не добавлено.',
    alreadyResolved: 'Это возражение уже рассмотрено.',
  },

  // The Coherence Guard, as a number — CONTEXT.md § Coherence Guard, ADR 0003.
  //
  // Shown on the Disputes screen and nowhere else, because a guard firing and an
  // upheld objection are the two ways the system records that the Grader was
  // wrong. A Student never meets this rule, so the wording is for the one person
  // who reviews judgements: it names what the rule does rather than what it is
  // called in the code.
  coherenceGuard: {
    title: 'Сверка оценки с ошибками',
    explanation:
      'Проверяющий предлагает оценку, а сервер сверяет её со списком ошибок: без ошибок оценка становится «верно», а при найденных ошибках «верно» снимается. Ниже — сколько раз сверка изменила оценку.',
    // Zero is the expected reading, and it renders as plainly as any other
    // number: the guard did not fire once in the 24 measured calls, and a panel
    // that looked broken at zero would be a panel nobody trusts at one.
    fired: (fired: number, judged: number) =>
      `Сверка изменила оценку ${fired} ${plural(fired, 'раз', 'раза', 'раз')} из ${judged} ${plural(judged, 'проверенного ответа', 'проверенных ответа', 'проверенных ответов')}.`,
    forcedCorrect: (n: number) => `Ошибок не найдено, оценка повышена до «верно»: ${n}`,
    forbadeCorrect: (n: number) => `Ошибки найдены, оценка «верно» снята: ${n}`,
    // Nothing has been judged yet: not a firing of zero, because zero out of
    // nothing is not evidence about the rule.
    nothingJudged: 'Проверяющий пока не оценил ни одного ответа.',
  },

  // design.md § Progress and statistics — where a Student stands, what they get
  // wrong, and whether that is improving. One screen, three sections.
  progress: {
    title: 'Прогресс',
    link: 'Прогресс',
    // Shown only when an Admin is looking at somebody else's record, because a
    // screen that does not say whose it is invites a decision about the wrong
    // person.
    viewingStudent: (username: string) => `Прогресс студента: ${username}`,
    chooseStudent: 'Чей прогресс показать',

    lessonsTitle: 'Уроки',
    courseTotal: 'Курс целиком',
    // Read out beside the bar, because a bar alone is not a number.
    percent: (n: number) => `${n}%`,
    breakdown: (completed: number, withHelp: number, total: number) =>
      `Пройдено самостоятельно: ${completed} · с подсказкой: ${withHelp} · всего: ${total}`,
    locked: 'ещё не открыт',
    noLessons: 'В этом курсе пока нет опубликованных уроков.',

    attemptsTitle: 'Попытки в тестах',
    noAttempts: 'Тесты пока не сдавались.',
    attemptLine: (test: string, attempt: number) => `${test}, попытка ${attempt}`,
    // A score is withheld until every answer has been judged: an unfinished
    // judgement is not a zero.
    attemptPending: 'Ещё проверяется',
    attemptFailedGrading: 'Проверка не завершилась',
  },

  // design.md § Progress and statistics — «артикли — 14 ошибок».
  errorStats: {
    title: 'Ошибки по типам',
    // The whole point of the ordering: the largest count is what to work on next.
    hint: 'Считаются все ответы — и в уроках, и в тестах. Сверху то, что встречается чаще всего.',
    none: 'Ошибок пока нет — либо ещё нечего считать.',
    count: (n: number) => `${n} ${plural(n, 'ошибка', 'ошибки', 'ошибок')}`,
    typeHeading: 'Тип ошибки',
    countHeading: 'Сколько раз',
  },

  // design.md § Progress and statistics: charts over selected Lessons, to show
  // change over time. The only view in the application that answers whether the
  // studying is working.
  changeOverTime: {
    title: 'Как меняется со временем',
    hint: 'Выберите отрезок уроков — сколько раз встречался каждый тип ошибки.',
    from: 'С урока',
    to: 'По урок',
    // Errors made in a Test belong to no Lesson, so they are counted in the table
    // above and not on this chart. Saying so is cheaper than a wrong conclusion.
    testsExcluded: 'Ошибки из тестов сюда не попадают — они относятся не к уроку.',
    // Said rather than drawn: an empty chart looks like a broken chart.
    noErrors: 'На выбранном отрезке ошибок нет.',
    noLessons: 'Пока не из чего выбирать — в курсе нет опубликованных уроков.',
    lessonShort: (position: number) => `У${position}`,
    tableCaption: 'Те же числа, по урокам',
    // A cap, and it is said out loud rather than silently dropping the rest.
    shownSeries: (shown: number, all: number) =>
      `Показаны ${shown} самых частых типов из ${all}. Остальные — в таблице ниже.`,
    total: 'Всего',
  },

  // A Test, from the Student's side. design.md § Tests: no feedback until it is
  // submitted, a score against a threshold, unlimited retakes, and nothing gated
  // either way.
  test: {
    sectionTitle: 'Проверочные работы',
    none: 'В этом курсе пока нет проверочных работ.',
    exerciseCount: (n: number) => `${n} ${plural(n, 'задание', 'задания', 'заданий')}`,
    threshold: (n: number) => `Порог прохождения: ${n}%`,
    start: 'Пройти работу',
    retake: 'Пройти ещё раз',
    // Said before the first answer rather than discovered after it: a Student who
    // expects the usual per-answer feedback will otherwise think it is broken.
    noFeedbackUntilSubmit:
      'Работа проверяется целиком после отправки. Пока вы её пишете, никаких подсказок и оценок не будет.',
    gatesNothing:
      'Результат работы ни на что не влияет: уроки открываются своим порядком, сколько бы раз вы её ни проходили.',
    empty: 'В этой работе пока нет заданий.',
    position: (n: number, total: number) => `Задание ${n} из ${total}`,
    submit: 'Отправить работу',
    submitting: 'Отправка…',
    submitFailed: 'Не удалось отправить работу. Попробуйте ещё раз.',
    unanswered: (n: number) =>
      `Без ответа ${n} ${plural(n, 'задание', 'задания', 'заданий')}. Отправить работу?`,
    submitAnyway: 'Отправить',
    keepAnswering: 'Вернуться к работе',

    // Attempts. Every one is kept, and the point of taking a Test twice is the
    // difference between the two.
    attemptsTitle: 'Ваши попытки',
    noAttempts: 'Вы ещё не проходили эту работу.',
    attemptNumber: (n: number) => `Попытка ${n}`,
    score: (correct: number, total: number, percent: number) =>
      `${correct} из ${total} — ${percent}%`,
    passed: 'Работа пройдена',
    failed: 'Работа не пройдена',
    notScored: 'Оценка не выставлена',

    // The batch, while it is out and when it fails. design.md § Failure
    // behaviour: never a wrong answer, and it must not read like one either.
    grading: 'Свободные ответы проверяются…',
    gradingExplanation:
      'Все свободные ответы проверяются одним запросом, поэтому это дольше обычного. Страница обновится сама.',
    gradingFailed:
      'Не удалось проверить свободные ответы — это сбой проверки, а не ошибка в ваших ответах. Оценка не выставлена, ответы сохранены.',
    regrade: 'Проверить ещё раз',
    regrading: 'Проверка…',
    regradeFailed: 'Проверить снова не удалось. Попробуйте позже.',

    // The review.
    reviewTitle: 'Разбор работы',
    reviewHint: 'Верные задания свёрнуты — разверните, если хотите их посмотреть.',
    showExercise: 'Показать',
    hideExercise: 'Свернуть',
    // What a judged Exercise is called comes from `ru.states` — one definition
    // per state, so a review and a Practice cannot end up using different words
    // for the same fact. What is left here is the one thing that is not a state:
    // a batch that has not landed yet, which is not a judgement of anything.
    awaitingAnswer: 'Ещё не проверено',
    yourAnswer: 'Ваш ответ',
    noAnswer: 'Ответа нет',
    referenceAnswer: 'Правильный ответ',
    backToTest: 'К работе',
    backToCourse: 'К курсу',
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
    // Reported by the Grader and dropped before storage (design.md § Error Type
    // enum), so this label is only ever read of a row written before #78.
    typography: 'Оформление текста',
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
      'Это упражнение проверяется без Проверяющего, поэтому для каждого пропуска нужен хотя бы один принимаемый ответ.',
    // The prompt says how many places there are to answer; the accepted answers
    // say how many there are to judge. An Exercise where the two disagree cannot
    // be shown to a Student at all — one input would have nothing behind it.
    gap_count_mismatch:
      'Число пропусков «___» в формулировке не совпадает с числом наборов принимаемых ответов.',
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
    // A fill-gap's prompt is what says how many places there are to answer, so
    // the notation is worth stating rather than leaving an author to infer from
    // the fixture.
    gapHint: 'Пропуск обозначается тремя подчёркиваниями: ___. Сколько их в формулировке, столько будет полей у студента.',
    noGaps: 'В формулировке нет ни одного пропуска «___», поэтому отвечать негде.',
    acceptedAnswersAtGap: (n: number) => `Принимаемые ответы, пропуск ${n}`,
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
    // A request the server could not read at all. Seen only by a stale tab or a
    // hand-made call, so it says what it can without guessing.
    badRequest: 'Запрос не понят.',
  },
} as const;

// An Error Type the enum does not know about is a contract violation the Grader
// module already reports; here it is simply shown as it came, because dropping
// the Error entirely would hide a real fault from the Student.
export function errorTypeLabel(type: string): string {
  return ru.errorTypes[type] ?? type;
}

// A fault code is about the Lesson, about one of its Exercises, about a write in
// the Admin section or about an account, and the form that shows it does not
// care which. An
// unknown code is shown as it came, for the same reason an unknown Error Type
// is: dropping it would hide a real fault from the person who has to fix it.
export function faultMessage(code: string): string {
  const lessonLevel: Record<string, string> = ru.documentFaults;
  const exerciseLevel: Record<string, string> = ru.exerciseFaults;
  const authoring: Record<string, string> = ru.authoringFaults;
  const accounts: Record<string, string> = ru.accountFaults;
  const uploads: Record<string, string> = ru.uploadRefusals;
  const generation: Record<string, string> = ru.generationFaults;
  const tests: Record<string, string> = ru.testFaults;
  const imports: Record<string, string> = ru.importFaults;
  const guidance: Record<string, string> = ru.guidanceFaults;
  return lessonLevel[code] ?? exerciseLevel[code] ?? authoring[code] ?? accounts[code]
    ?? uploads[code] ?? generation[code] ?? tests[code] ?? imports[code] ?? guidance[code] ?? code;
}
