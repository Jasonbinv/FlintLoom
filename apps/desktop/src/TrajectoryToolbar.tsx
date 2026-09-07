export type TrajectoryToolbarProps = {
  query: string;
  onQueryChange: (query: string) => void;
};

export function TrajectoryToolbar({ query, onQueryChange }: TrajectoryToolbarProps) {
  return (
    <input
      type="search"
      className="trajectory-search"
      aria-label="搜索轨迹"
      placeholder="搜索"
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
    />
  );
}
