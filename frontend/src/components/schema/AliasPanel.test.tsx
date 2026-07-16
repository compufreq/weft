import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import AliasPanel from "./AliasPanel";

const noop = () => Promise.resolve();

describe("AliasPanel", () => {
  it("shows the degradation reason when unsupported", () => {
    render(() => (
      <AliasPanel
        supported={false}
        reason="aliases need Weaviate ≥ 1.32 (this instance runs 1.30.1)"
        aliases={[]}
        classes={[]}
        readOnly={false}
        onCreate={noop}
        onRetarget={noop}
        onDelete={noop}
      />
    ));
    expect(screen.getByText(/1\.30\.1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create alias" })).not.toBeInTheDocument();
  });

  it("lists aliases and creates a new one", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <AliasPanel
        supported={true}
        aliases={[{ alias: "Live", class: "ArticleV1" }]}
        classes={["ArticleV1", "ArticleV2"]}
        readOnly={false}
        onCreate={onCreate}
        onRetarget={noop}
        onDelete={noop}
      />
    ));
    expect(screen.getByText("Live")).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText("New alias"), { target: { value: "Next" } });
    fireEvent.change(screen.getByLabelText("Points at"), { target: { value: "ArticleV2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create alias" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Next", "ArticleV2"));
  });

  it("retargets and deletes via the row controls", async () => {
    const onRetarget = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <AliasPanel
        supported={true}
        aliases={[{ alias: "Live", class: "ArticleV1" }]}
        classes={["ArticleV1", "ArticleV2"]}
        readOnly={false}
        onCreate={noop}
        onRetarget={onRetarget}
        onDelete={onDelete}
      />
    ));
    fireEvent.change(screen.getByLabelText("Target for alias Live"), {
      target: { value: "ArticleV2" },
    });
    await waitFor(() => expect(onRetarget).toHaveBeenCalledWith("Live", "ArticleV2"));
    fireEvent.click(screen.getByLabelText("Delete alias Live"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("Live"));
  });

  it("read-only hides every mutation control", () => {
    render(() => (
      <AliasPanel
        supported={true}
        aliases={[{ alias: "Live", class: "ArticleV1" }]}
        classes={["ArticleV1"]}
        readOnly={true}
        onCreate={noop}
        onRetarget={noop}
        onDelete={noop}
      />
    ));
    expect(screen.queryByLabelText("Target for alias Live")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete alias Live")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create alias" })).not.toBeInTheDocument();
  });
});
