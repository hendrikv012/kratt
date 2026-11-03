import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, beforeEach, afterEach, test, expect } from "vitest";
import DesktopGate from "./DesktopGate";
import { startDesktop, connection, openDesktop } from "./runtime";
import { createVaultClient } from "../views/studyhome/data/vaultClient";

vi.mock("./runtime", () => ({ isDesktop: () => true, connection: vi.fn(), startDesktop: vi.fn(), openDesktop: vi.fn() }));
vi.mock("../views/studyhome/data/vaultClient", () => ({ createVaultClient: vi.fn() }));
let client;
beforeEach(() => {
  vi.clearAllMocks();
  connection.mockReturnValue({ studyDir: "/example/Study" });
  startDesktop.mockResolvedValue({});
  client = { preferences: vi.fn().mockResolvedValue({ preferences: {} }), localStatus: vi.fn().mockResolvedValue({ state: "not-installed", models: [] }), health: vi.fn().mockResolvedValue({ ok: true }) };
  createVaultClient.mockReturnValue(client);
});
afterEach(() => vi.useRealTimers());
test("offers Ollama installation and opens notes without AI", async () => {
  render(<DesktopGate><div>My notes</div></DesktopGate>);
  fireEvent.click(await screen.findByText("Install Ollama"));
  expect(openDesktop).toHaveBeenCalledWith("ollama");
  fireEvent.click(screen.getByText("Continue to notes"));
  expect(screen.getByText("My notes")).toBeVisible();
});
test("engine startup failure has a working retry and logs action", async () => {
  startDesktop.mockRejectedValueOnce(new Error("Engine missing"));
  render(<DesktopGate><div>My notes</div></DesktopGate>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Engine missing");
  fireEvent.click(screen.getByText("Open logs"));
  expect(openDesktop).toHaveBeenCalledWith("logs");
  fireEvent.click(screen.getByText("Retry"));
  await screen.findByText("Install Ollama");
  expect(startDesktop).toHaveBeenCalledTimes(2);
});
test("restores disk preferences before mounting the workspace", async () => {
  const data = {};
  connection.mockReturnValue(data);
  client.preferences.mockResolvedValue({ preferences: { appearance: { themeId: "chalk" } } });
  client.localStatus.mockResolvedValue({ state: "running", model: "llama3.2", models: ["llama3.2:latest"] });
  render(<DesktopGate><div>My notes</div></DesktopGate>);
  await screen.findByText("My notes");
  expect(data.preferences.appearance.themeId).toBe("chalk");
});
test("a stopped engine preserves the mounted workspace while retrying", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  client.localStatus.mockResolvedValue({ state: "running", model: "local", models: ["local"] });
  render(<DesktopGate><input aria-label="Note" defaultValue="Unsaved work" /></DesktopGate>);
  await screen.findByLabelText("Note");
  client.health.mockRejectedValue(new Error("gone"));
  await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
  await waitFor(() => expect(screen.getByText("Retry")).toBeVisible());
  const note = screen.getByLabelText("Note");
  expect(note).toHaveValue("Unsaved work");
  fireEvent.click(screen.getByText("Retry"));
  await waitFor(() => expect(note).toBeVisible());
});
