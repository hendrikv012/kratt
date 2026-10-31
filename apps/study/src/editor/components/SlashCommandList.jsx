import React, {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { Command } from "cmdk";

// The "/" menu. The note keeps focus while it is open: the editor passes the arrow keys and
// Enter here (onKeyDown below), and the mouse highlights on hover and picks on click. Colours,
// radius and font come from the app's theme (the menu is shown inside `.study`).
const SlashCommandList = forwardRef((props, ref) => {
  const [value, setValue] = useState("");
  const listRef = useRef(null);

  const allItems = useMemo(() =>
    props.items.flatMap(group => group.commands),
    [props.items]
  );

  // Typing more narrows the list; the first match is highlighted again.
  useEffect(() => {
    setValue(allItems[0]?.title ?? "");
  }, [allItems]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [value]);

  const selectItem = (itemTitle) => {
    const item = allItems.find(i => i.title === itemTitle);
    if (item) {
      props.command(item);
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (!allItems.length) return true;
        const idx = allItems.findIndex(i => i.title === value);
        const next = event.key === "ArrowDown"
          ? (idx + 1) % allItems.length
          : (idx - 1 + allItems.length) % allItems.length;
        setValue(allItems[next].title);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        // With nothing matching, Enter is a normal new line.
        if (!allItems.length) return false;
        selectItem(value);
        return true;
      }
      return false;
    },
  }));

  return (
    <Command
      value={value}
      onValueChange={setValue}
      shouldFilter={false}
      label="Commands"
      // Keeps the cursor in the note when the menu is clicked.
      onMouseDown={(e) => e.preventDefault()}
      className="w-80 overflow-hidden rounded-st border border-st-border bg-st-popover text-st-popover-foreground shadow-md"
    >
      <Command.List
        ref={listRef}
        className="max-h-[330px] overflow-y-auto overflow-x-hidden p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Command.Empty className="py-6 text-center text-sm text-st-muted-foreground">No commands match.</Command.Empty>
        {props.items.map((group, groupIndex) => (
          <React.Fragment key={group.group}>
            <Command.Group
              heading={group.group}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-st-muted-foreground"
            >
              {group.commands.map((item) => (
                <Command.Item
                  key={item.title}
                  value={item.title}
                  onSelect={selectItem}
                  className="flex cursor-pointer select-none items-center gap-3 rounded-st-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-st-accent data-[selected=true]:text-st-accent-foreground"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-st-sm border border-st-border bg-st-background">
                    {item.icon}
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{item.title}</span>
                    <span className="truncate text-xs text-st-muted-foreground">
                      {item.description}
                    </span>
                  </div>
                </Command.Item>
              ))}
            </Command.Group>
            {groupIndex < props.items.length - 1 && <Command.Separator className="-mx-1 my-1 h-px bg-st-border" />}
          </React.Fragment>
        ))}
      </Command.List>
    </Command>
  );
});

SlashCommandList.displayName = "SlashCommandList";

export default SlashCommandList;
