export default function InternalLoading() {
  return (
    <main className="loading-state" aria-live="polite" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <p>Загрузка данных…</p>
    </main>
  );
}
