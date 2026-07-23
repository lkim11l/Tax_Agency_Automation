import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page">
      <div className="status-card">
        <h1>Page not found</h1>
        <p>The requested page does not exist.</p>
        <Link href="/applications">Go to applications</Link>
      </div>
    </main>
  );
}
