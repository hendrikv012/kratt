import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ModelDownload from "./ModelDownload";

test("downloads only on request, then requires explicit model selection", async () => {
  const client = { pullStatus: vi.fn().mockResolvedValue({ state: "idle" }), pullModel: vi.fn().mockResolvedValue({ state: "done", model: "llama3.2:3b" }), setLocalAi: vi.fn().mockResolvedValue({}) };
  const done = vi.fn();
  render(<ModelDownload client={client} onDone={done} />);
  await waitFor(() => expect(client.pullStatus).toHaveBeenCalled());
  expect(client.pullModel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Download model"));
  await screen.findByText("llama3.2:3b is downloaded.");
  expect(client.pullModel).toHaveBeenCalledWith("llama3.2:3b");
  expect(client.setLocalAi).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Use downloaded model"));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(client.setLocalAi).toHaveBeenCalledWith({ local: true, model: "llama3.2:3b" });
});

test("a failed download stays actionable and does not select a model", async () => {
  const client = { pullStatus: vi.fn().mockResolvedValue({ state: "idle" }), pullModel: vi.fn().mockRejectedValue(new Error("Ollama is unavailable")), setLocalAi: vi.fn() };
  render(<ModelDownload client={client} />);
  fireEvent.click(screen.getByText("Download model"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Ollama is unavailable");
  expect(screen.getByText("Download model")).toBeEnabled();
  expect(client.setLocalAi).not.toHaveBeenCalled();
});
