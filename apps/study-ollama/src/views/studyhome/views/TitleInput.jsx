import { useEffect, useState } from "react";
import { useStudy } from "../data/StudyProvider";
import { UNSORTED } from "../data/tree";

// The big editable title at the top of a subject, folder or page.
// autoFocus selects it, for something just created.
export default function TitleInput({ id, autoFocus = false }) {
  const { state, actions } = useStudy();
  const name = state.nodes[id].name;
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name, id]);

  if (id === UNSORTED) return <h1 className="st-page-title">{name}</h1>;

  return (
    <input
      className="st-page-title st-title-input"
      value={value}
      aria-label="Title"
      autoFocus={autoFocus}
      onFocus={(e) => autoFocus && e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => actions.rename(id, value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      // Keep the browser's own menu (spelling, cut, paste) instead of the page's.
      onContextMenu={(e) => e.stopPropagation()}
    />
  );
}
