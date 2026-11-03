import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OnlineAiRows from "./OnlineAiRows";
import { useStudy } from "../data/StudyProvider";
import { openDesktopAuth } from "../../../desktop/runtime";
vi.mock("../data/StudyProvider", () => ({ useStudy: vi.fn() }));
vi.mock("../../../desktop/runtime", () => ({ openDesktop: vi.fn(), openDesktopAuth: vi.fn() }));
let client;
beforeEach(() => {
  vi.clearAllMocks();
  client = {
    aiSettings: vi.fn().mockResolvedValue({ provider: "openai", profiles: {}, chatgpt: { accounts: [] }, claudeInstalled: true }),
    saveAiSettings: vi.fn().mockImplementation(async v => ({ provider: v.provider, profiles: { [v.provider]: { model: v.model, keySet: !!v.key } } })),
    aiModels: vi.fn().mockResolvedValue({ models: [{ id: "account-model", name: "Available model" }] }),
    chatgptLogin: vi.fn().mockResolvedValue({ url: "https://auth.openai.com/api/accounts/authorize?state=example" }),
    chatgptCancel: vi.fn().mockResolvedValue({}),
    claudeStatus: vi.fn().mockResolvedValue({ installed: true, signedIn: true }),
  };
  useStudy.mockReturnValue({ client });
});
async function ready() { render(<OnlineAiRows />); await waitFor(() => expect(screen.getByLabelText("Provider")).not.toBeDisabled()); }
test("saves through the engine and clears the secret input", async () => {
  await ready();
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: "private-test-key" } });
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "chosen-model" } });
  fireEvent.click(screen.getByText("Save AI provider"));
  await screen.findByText("AI provider saved.");
  expect(client.saveAiSettings).toHaveBeenCalledWith({ provider: "openai", model: "chosen-model", key: "private-test-key" });
  expect(screen.getByLabelText("API key")).toHaveValue("");
});
test("opens official ChatGPT sign-in", async () => {
  await ready(); fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "chatgpt" } });
  expect(screen.queryByLabelText("API key")).toBeNull();
  fireEvent.click(screen.getByText("Continue with ChatGPT"));
  await waitFor(() => expect(openDesktopAuth).toHaveBeenCalledWith("https://auth.openai.com/api/accounts/authorize?state=example"));
  expect(client.chatgptLogin).toHaveBeenCalledWith(null);
});
test("loads models and saves an explicit choice", async () => {
  await ready(); fireEvent.click(screen.getByText("Load models"));
  await screen.findByText("1 models loaded. Choose a model, then save.");
  expect(screen.getByRole("option", { name: "Available model" })).toHaveValue("account-model");
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "account-model" } });
  fireEvent.click(screen.getByText("Save AI provider")); await screen.findByText("AI provider saved.");
  expect(client.saveAiSettings).toHaveBeenLastCalledWith({ provider: "openai", model: "account-model" });
});
test("shows connection failures", async () => {
  client.aiModels.mockRejectedValue(new Error("The provider refused access."));
  await ready(); fireEvent.click(screen.getByText("Load models"));
  expect(await screen.findByRole("alert")).toHaveTextContent("provider refused access");
});
test("checks the installed Claude client", async () => {
  await ready(); fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "claude-code" } });
  fireEvent.click(screen.getByText("Check Claude connection"));
  await screen.findByText("Claude subscription is connected.");
});
test("cancels sign-in if the browser cannot open", async () => {
  openDesktopAuth.mockRejectedValueOnce(new Error("Could not open browser"));
  await ready(); fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "chatgpt" } });
  fireEvent.click(screen.getByText("Continue with ChatGPT"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not open browser");
  expect(client.chatgptCancel).toHaveBeenCalledOnce();
});
