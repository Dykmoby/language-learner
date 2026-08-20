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
    noCourses: 'Курсы пока не добавлены.',
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

  errors: {
    notFound: 'Страница не найдена.',
    serverError: 'Что-то пошло не так.',
  },
} as const;
