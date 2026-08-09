import { Button } from './button';

export function RegisterPagination({
  page,
  pageCount,
  onPageChange,
  disabled = false,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const safePageCount = Math.max(1, pageCount);

  return (
    <nav
      className="mt-4 flex items-center gap-2 text-sm"
      aria-label="Register pagination"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Prev
      </Button>
      <span className="text-muted-foreground" aria-live="polite">
        Page {page} of {safePageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page >= safePageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
