import { useState } from "react";

export default function AINotebook({ workspacePath }) {
  const [loadFailed, setLoadFailed] = useState(false);

  return (
    <div className="h-full w-full flex flex-col">
      {loadFailed ? (
        <div className="flex-1 flex items-center justify-center text-center p-8">
          <div>
            <p className="text-app-text mb-2">Couldn't reach Open Notebook.</p>
            <p className="text-sm text-app-text-secondary">
              Make sure it's running (make start-all in the open-notebook folder),
              then reopen this tab.
            </p>
          </div>
        </div>
      ) : (
        <iframe
          src="http://localhost:8502"
          title="AI Notebook"
          style={{ width: "100%", height: "100%", border: "none", flex: 1 }}
          onError={() => setLoadFailed(true)}
        />
      )}
    </div>
  );
}