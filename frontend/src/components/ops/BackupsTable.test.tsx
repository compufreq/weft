import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import BackupsTable from "./BackupsTable";
import type { Backup } from "~/lib/api";

const backups: Backup[] = [
  { id: "weft-1784217013", status: "SUCCESS", classes: ["Article", "Product"] },
  { id: "weft-1784217999", status: "STARTED" },
];

describe("BackupsTable", () => {
  it("renders backups with status badges and classes", () => {
    render(() => <BackupsTable backups={backups} />);
    expect(screen.getByText("weft-1784217013")).toBeInTheDocument();
    expect(screen.getByText("SUCCESS")).toBeInTheDocument();
    expect(screen.getByText("STARTED")).toBeInTheDocument();
    expect(screen.getByText("Article, Product")).toBeInTheDocument();
  });

  it("reports restore clicks", () => {
    const onRestore = vi.fn();
    render(() => <BackupsTable backups={backups} onRestore={onRestore} />);
    fireEvent.click(screen.getAllByText("Restore…")[0]);
    expect(onRestore).toHaveBeenCalledWith(backups[0]);
  });

  it("renders an empty state", () => {
    render(() => <BackupsTable backups={[]} />);
    expect(screen.getByText(/no backups/i)).toBeInTheDocument();
  });
});
