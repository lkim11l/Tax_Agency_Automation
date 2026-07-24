import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page">
      <div className="status-card">
        <h1>Страница не найдена</h1>
        <p>Запрошенная страница не существует.</p>
        <Link href="/applications">Перейти к заявкам</Link>
      </div>
    </main>
  );
}
