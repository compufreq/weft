import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import RbacPanel from "./RbacPanel";

describe("RbacPanel", () => {
  it("shows the disabled reason when RBAC is off", () => {
    render(() => (
      <RbacPanel
        data={{
          enabled: false,
          reason: "RBAC is not enabled on this instance (AUTHORIZATION_RBAC_ENABLED)",
          roles: [],
          users: [],
        }}
      />
    ));
    expect(screen.getByText(/AUTHORIZATION_RBAC_ENABLED/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Roles")).not.toBeInTheDocument();
  });

  it("lists roles with permission counts and users with assignments", () => {
    render(() => (
      <RbacPanel
        data={{
          enabled: true,
          roles: [
            { name: "admin", permissions: [{}, {}, {}] },
            { name: "viewer", permissions: [{}] },
          ],
          users: [
            { user_id: "alice", active: true, roles: ["admin"] },
            { user_id: "bob", active: false, roles: [] },
          ],
          users_truncated: true,
        }}
      />
    ));
    // "admin" appears as a role name AND in alice's assignments.
    expect(screen.getAllByText("admin").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("3 permissions")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("no roles")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
    expect(screen.getByText(/Users \(2\+\)/)).toBeInTheDocument();
  });
});
