import { Icon } from "./Icon";

export function Notice({
  children,
  onDismiss,
}: {
  children: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={"notice " + (onDismiss ? "room-notice" : "toast")}
      role={onDismiss ? "alert" : "status"}
    >
      <Icon name={onDismiss ? "warning" : "check"} />
      <p>{children}</p>
      {onDismiss && (
        <button
          className="icon-button"
          aria-label="Dismiss error"
          onClick={onDismiss}
        >
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}
