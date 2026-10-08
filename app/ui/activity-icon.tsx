/** D3 · One small line icon per activity type, so each reads at a glance (decorative; the type is also in words). */
const P: Record<string, string> = {
  multiple_choice: "M5 6.5h.01M5 12h.01M5 17.5h.01M9 6.5h10M9 12h10M9 17.5h10",
  true_false: "M4 12.5l3 3 6-7M14.5 9.5l5 5M19.5 9.5l-5 5",
  matching: "M4 7h5l6 10h5M4 17h5l6-10h5",
  ordering: "M5 6h3M5 12h3M5 18h3M11 6h8M11 12h8M11 18h8M6.5 4.5v3",
  flashcard: "M4 7.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM17 8.5h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-8",
  short_answer: "M5 17h14M5 12.5h9M15.5 6.5l2 2-6 6H9.5v-2z",
  build_it: "M14 5l5 5-9 9H5v-5zM12 7l5 5",
  branching_scenario: "M6 4v8a4 4 0 0 0 4 4h8M6 12a4 4 0 0 0 4-4h8M15 5l3 3-3 3M15 13l3 3-3 3",
  spot_the_mistake: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20M8.5 8.5l4 4M12.5 8.5l-4 4",
  case_teardown: "M6 4h9l4 4v12H6zM15 4v4h4M9 12h7M9 16h5",
  teach_back: "M5 6.5h14v9H11l-4 3v-3H5zM8.5 10h7M8.5 12.5h4",
  mini_project: "M4 8h16v11H4zM9 8V5.5h6V8M4 12.5h16",
};
export function ActivityIcon({ type }: { type: string }) {
  return (
    <svg className="ui-icon ui-act__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[type] ?? P.short_answer} />
    </svg>
  );
}
