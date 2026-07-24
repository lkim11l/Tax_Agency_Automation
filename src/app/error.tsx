"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error", error);
  }, [error]);

  return (
    <main className="status-page">
      <div className="status-card">
        <h1>Произошла ошибка</h1>
        <p>Ошибка зарегистрирована. Попробуйте загрузить страницу ещё раз.</p>
        <button type="button" onClick={reset}>
          Повторить
        </button>
      </div>
    </main>
  );
}
