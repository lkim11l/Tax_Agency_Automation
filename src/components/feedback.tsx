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
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="alert alert-success" role="status">
          Changes saved successfully.
        </p>
      ) : null}
    </>
  );
}
