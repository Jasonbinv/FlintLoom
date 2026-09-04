export function WebSearchToggle(props: {
  disabled: boolean;
  value: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={
        props.value
          ? "composer-tool-btn composer-tool-btn--active"
          : "composer-tool-btn"
      }
      disabled={props.disabled}
      aria-pressed={props.value}
      onClick={() => props.onChange(!props.value)}
    >
      联网
    </button>
  );
}
