import { useCallback, useEffect, useRef, useState } from 'react';

/** Сколько живёт сообщение об успехе. Прочитать «Token saved» хватает и меньшего. */
const DEFAULT_TTL_MS = 8000;

/**
 * Сообщение о результате действия, которое само гаснет.
 *
 * Висящее сообщение перестаёт быть отчётом о действии и начинает читаться как
 * описание текущего состояния: «Token saved» под формой через десять минут после
 * сохранения выглядит как «токен в порядке», хотя говорит лишь о том, что когда-то
 * была нажата кнопка. Гасить его по таймеру честнее, чем ждать следующего действия.
 *
 * Ошибки не гаснут никогда: по ним нужно что-то делать, и исчезнувшая причина
 * отказа — это ровно тот случай, когда пользователь остаётся с неработающим
 * приложением и без объяснений. Гасятся они только следующим действием, которое
 * сообщение перезапишет.
 *
 * @returns {[object|null, (message: object|null) => void]} как useState
 */
export const useTransientMessage = ({ ttlMs = DEFAULT_TTL_MS } = {}) => {
  const [message, setMessageState] = useState(null);
  const timer = useRef(null);

  const stopTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const setMessage = useCallback(
    (next) => {
      stopTimer();
      setMessageState(next);
      if (next && next.appearance !== 'error') {
        timer.current = setTimeout(() => setMessageState(null), ttlMs);
      }
    },
    [ttlMs]
  );

  // Таймер переживает размонтирование, если его не снять: сработав, он позовёт
  // setState у компонента, которого уже нет.
  useEffect(() => stopTimer, []);

  return [message, setMessage];
};
