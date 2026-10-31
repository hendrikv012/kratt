import { Blocks } from "lucide-react";
import { Button } from "../ui/button";
import { useShell } from "../ShellContext";
import { Section } from "./controls";
import { InstalledExtensions } from "../extensions/ExtensionsView";

export default function ExtensionsSection() {
  const shell = useShell();
  return (
    <Section title="Extensions" description="Extensions add widgets, page blocks, tools and themes.">
      <div className="text-sm text-st-muted-foreground">
        <InstalledExtensions />
      </div>
      {shell?.openExtensions && (
        <Button variant="ghost" size="sm" className="mt-4 border border-st-border" onClick={() => shell.openExtensions()}>
          <Blocks />
          Open Extensions
        </Button>
      )}
    </Section>
  );
}
