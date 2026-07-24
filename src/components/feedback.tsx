export function Feedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error ? (
        <p className="alert alert-error" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="alert alert-success" role="status" aria-live="polite">
          {success}
        </p>
      ) : null}
    </>
  );
}
