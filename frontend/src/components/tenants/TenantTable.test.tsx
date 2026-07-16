import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import TenantTable from "./TenantTable";
import type { Tenant } from "~/lib/api";

const tenants: Tenant[] = [
  { name: "acme", activityStatus: "HOT", count: 5 },
  { name: "globex", activityStatus: "COLD", count: null },
];

describe("TenantTable", () => {
  it("shows status badges and counts (dash for unknown)", () => {
    render(() => <TenantTable tenants={tenants} />);
    expect(screen.getByText("HOT")).toBeInTheDocument();
    expect(screen.getByText("COLD")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("offers Deactivate for HOT and Activate for COLD; Browse only for HOT", () => {
    const onToggle = vi.fn();
    render(() => <TenantTable tenants={tenants} onToggle={onToggle} />);
    expect(screen.getByText("Deactivate")).toBeInTheDocument();
    expect(screen.getByText("Activate")).toBeInTheDocument();
    expect(screen.getAllByText("Browse")).toHaveLength(1);
    fireEvent.click(screen.getByText("Activate"));
    expect(onToggle).toHaveBeenCalledWith(tenants[1]);
  });

  it("renders an empty state", () => {
    render(() => <TenantTable tenants={[]} />);
    expect(screen.getByText(/no tenants/i)).toBeInTheDocument();
  });
});
