import Kratt from "../kratt/Kratt";

// The supplied design marks web search as future work. Keep that status explicit
// until a real search service exists; these controls must never fabricate results.
export default function FindSourcesPanel() {
  return (
    <section className="st-src-find" aria-label="Find sources with Kratt">
      <Kratt size={132} label="Kratt" />
      <div className="st-src-find-body">
        <h1>Find sources with Kratt</h1>
        <p>Tell Kratt what you're studying. He searches the web and suggests sources you can add to a subject.</p>
        <div className="st-src-find-controls">
          <input aria-label="What do you want to learn about?" placeholder="e.g. causes of the French Revolution" disabled aria-describedby="st-source-search-status" />
          <div className="st-src-search-depth" role="group" aria-label="Search depth">
            <button disabled aria-pressed="true">Regular</button>
            <button disabled aria-pressed="false">Deep</button>
          </div>
          <button className="st-src-search-button" disabled aria-describedby="st-source-search-status">Search</button>
        </div>
        <p id="st-source-search-status" className="st-src-search-status">Web search is not available yet. Open a subject below to add your own sources.</p>
      </div>
    </section>
  );
}
