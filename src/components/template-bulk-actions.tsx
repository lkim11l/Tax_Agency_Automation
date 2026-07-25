"use client";

export function SelectAllCheckbox({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Выбрать все"
      onChange={(event) => {
        const form = event.currentTarget.closest("form");
        if (!form) return;
        const boxes = form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
        boxes.forEach((box) => {
          box.checked = event.currentTarget.checked;
        });
      }}
    />
  );
}

export function BulkArchiveSubmitButton({
  name,
  className,
  emptyMessage,
  confirmMessageTemplate,
  children,
}: {
  name: string;
  className?: string;
  emptyMessage: string;
  /** Plain string containing the literal token "{count}", replaced with the selected count. */
  confirmMessageTemplate: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        const form = event.currentTarget.closest("form");
        const checked = form?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`) ?? [];
        if (checked.length === 0) {
          event.preventDefault();
          window.alert(emptyMessage);
          return;
        }
        const message = confirmMessageTemplate.replace("{count}", String(checked.length));
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </button>
  );
}
