import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Button } from "./button";
import { Switch } from "./switch";
import { Input } from "./input";
import { Badge } from "./badge";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./tooltip";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "./dropdown-menu";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "./context-menu";

describe("study shadcn components", () => {
  it("dialog uses study colors and stays flat", async () => {
    render(<Dialog open><DialogContent><DialogTitle>Settings</DialogTitle></DialogContent></Dialog>);
    const d = await screen.findByRole("dialog", { name: "Settings" });
    expect(d.className).toMatch(/bg-st-popover/);
    expect(d.className).not.toMatch(/shadow/);
  });

  it("button has only the default and ghost variants", () => {
    render(<><Button>Save</Button><Button variant="ghost" size="iconSm">Cancel</Button></>);
    expect(screen.getByText("Save").className).toMatch(/bg-st-primary/);
    expect(screen.getByText("Cancel").className).toMatch(/hover:bg-st-accent/);
  });

  it("switch toggles", () => {
    render(<Switch aria-label="x" />);
    const s = screen.getByRole("switch", { name: "x" });
    expect(s.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(s);
    expect(s.getAttribute("aria-checked")).toBe("true");
  });

  it("input and badge use study names", () => {
    render(<><Input aria-label="n" /><Badge>New</Badge></>);
    expect(screen.getByLabelText("n").className).toMatch(/border-st-input/);
    expect(screen.getByText("New").className).toMatch(/st-/);
  });

  it("toggle group selects an item", () => {
    render(<ToggleGroup type="single"><ToggleGroupItem value="a">A</ToggleGroupItem></ToggleGroup>);
    fireEvent.click(screen.getByText("A"));
    expect(screen.getByText("A").getAttribute("aria-checked")).toBe("true");
  });

  it("tooltip content is flat", async () => {
    render(
      <TooltipProvider>
        <Tooltip open><TooltipTrigger>t</TooltipTrigger><TooltipContent>Hint</TooltipContent></Tooltip>
      </TooltipProvider>
    );
    const tips = await screen.findAllByText("Hint");
    expect(tips[0].className).toMatch(/bg-st-primary/);
    expect(tips[0].className).not.toMatch(/shadow/);
  });

  it("dropdown menu renders items flat", async () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>o</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Lbl</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Item</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Chk</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const menu = await screen.findByRole("menu");
    expect(menu.className).toMatch(/bg-st-popover/);
    expect(menu.className).not.toMatch(/shadow/);
    expect(screen.getByText("Item")).toBeTruthy();
  });

  it("context menu renders flat", async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>target</ContextMenuTrigger>
        <ContextMenuContent><ContextMenuItem>Rename</ContextMenuItem></ContextMenuContent>
      </ContextMenu>
    );
    fireEvent.contextMenu(screen.getByText("target"));
    const menu = await screen.findByRole("menu");
    expect(menu.className).toMatch(/bg-st-popover/);
    expect(menu.className).not.toMatch(/shadow/);
  });

  // The dialog and the menus ship different copies of Radix's layer stack, so
  // the dialog has to step aside on its own while a menu inside it is open.
  it("Escape in a menu inside a dialog closes only the menu", async () => {
    const onDialog = vi.fn();
    render(
      <Dialog open onOpenChange={onDialog}>
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>Font</DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem>Geist</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </DialogContent>
      </Dialog>
    );
    await screen.findByRole("menu");
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(onDialog).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(onDialog).toHaveBeenCalledWith(false);
  });

  it("Escape with no menu open still closes the dialog", async () => {
    const onDialog = vi.fn();
    render(<Dialog open onOpenChange={onDialog}><DialogContent><DialogTitle>Settings</DialogTitle></DialogContent></Dialog>);
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    expect(onDialog).toHaveBeenCalledWith(false);
  });
});
