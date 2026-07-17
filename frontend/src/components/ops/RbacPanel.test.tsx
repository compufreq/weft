import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import RbacPanel, {
  apiUserType,
  buildPermission,
  permissionSummary,
} from "./RbacPanel";
import type { RbacOverview } from "~/lib/api";

const noop = () => Promise.resolve();

const handlers = {
  onCreateRole: noop,
  onDeleteRole: noop,
  onAddPermission: noop,
  onRemovePermission: noop,
  onAssign: noop,
  onRevoke: noop,
};

const overview: RbacOverview = {
  enabled: true,
  roles: [
    {
      name: "admin",
      permissions: [
        { action: "read_data", data: { collection: "*" } },
        { action: "read_cluster" },
      ],
    },
    { name: "viewer", permissions: [{ action: "read_data", data: { collection: "Docs" } }] },
  ],
  users: [
    { user_id: "alice", roles: ["admin"], user_type: "db_user" },
    { user_id: "env-admin", roles: [], user_type: "db_env_user" },
  ],
};

describe("RbacPanel helpers", () => {
  it("builds permission objects per action domain", () => {
    expect(buildPermission("read_data", "Docs")).toEqual({
      action: "read_data",
      data: { collection: "Docs" },
    });
    expect(buildPermission("create_collections", "")).toEqual({
      action: "create_collections",
      collections: { collection: "*" },
    });
    expect(buildPermission("manage_backups", "*")).toEqual({
      action: "manage_backups",
      backups: { collection: "*" },
    });
    expect(buildPermission("read_cluster", "*")).toEqual({ action: "read_cluster" });
  });

  it("summarizes permissions and maps user types", () => {
    expect(permissionSummary({ action: "read_data", data: { collection: "Docs" } })).toBe(
      "read_data (Docs)",
    );
    expect(permissionSummary({ action: "read_cluster" })).toBe("read_cluster");
    expect(apiUserType("db_user")).toBe("db");
    expect(apiUserType("db_env_user")).toBe("db");
    expect(apiUserType(null)).toBeUndefined();
  });
});

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
        readOnly={false}
        {...handlers}
      />
    ));
    expect(screen.getByText(/AUTHORIZATION_RBAC_ENABLED/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Roles")).not.toBeInTheDocument();
  });

  it("lists roles and users, and hides every manage control in read-only", () => {
    render(() => <RbacPanel data={overview} readOnly={true} {...handlers} />);
    expect(screen.getByLabelText("Toggle permissions of admin")).toBeInTheDocument();
    expect(screen.getByText("2 permissions")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByLabelText("New role name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete role admin")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assign role to alice")).not.toBeInTheDocument();
  });

  it("creates a role with a guided permission", async () => {
    const onCreateRole = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <RbacPanel data={overview} readOnly={false} {...handlers} onCreateRole={onCreateRole} />
    ));
    fireEvent.input(screen.getByLabelText("New role name"), {
      target: { value: "editor" },
    });
    fireEvent.change(screen.getByLabelText("New role first action"), {
      target: { value: "update_data" },
    });
    fireEvent.input(screen.getByLabelText("New role collection filter"), {
      target: { value: "Docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create role" }));
    await waitFor(() =>
      expect(onCreateRole).toHaveBeenCalledWith("editor", [
        { action: "update_data", data: { collection: "Docs" } },
      ]),
    );
  });

  it("expands a role, removes and adds permissions", async () => {
    const onRemovePermission = vi.fn().mockResolvedValue(undefined);
    const onAddPermission = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <RbacPanel
        data={overview}
        readOnly={false}
        {...handlers}
        onRemovePermission={onRemovePermission}
        onAddPermission={onAddPermission}
      />
    ));
    fireEvent.click(screen.getByLabelText("Toggle permissions of admin"));
    fireEvent.click(
      screen.getByLabelText("Remove permission read_cluster from admin"),
    );
    await waitFor(() =>
      expect(onRemovePermission).toHaveBeenCalledWith("admin", { action: "read_cluster" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add permission" }));
    await waitFor(() =>
      expect(onAddPermission).toHaveBeenCalledWith("admin", {
        action: "read_data",
        data: { collection: "*" },
      }),
    );
  });

  it("assigns and revokes roles on users with the mapped user type", async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined);
    const onRevoke = vi.fn().mockResolvedValue(undefined);
    render(() => (
      <RbacPanel
        data={overview}
        readOnly={false}
        {...handlers}
        onAssign={onAssign}
        onRevoke={onRevoke}
      />
    ));
    fireEvent.change(screen.getByLabelText("Assign role to env-admin"), {
      target: { value: "viewer" },
    });
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith("env-admin", "viewer", "db"));
    fireEvent.click(screen.getByLabelText("Revoke admin from alice"));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith("alice", "admin", "db"));
  });

  it("deletes a role behind a confirm", async () => {
    const onDeleteRole = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(() => (
      <RbacPanel data={overview} readOnly={false} {...handlers} onDeleteRole={onDeleteRole} />
    ));
    fireEvent.click(screen.getByLabelText("Delete role viewer"));
    await waitFor(() => expect(onDeleteRole).toHaveBeenCalledWith("viewer"));
    confirmSpy.mockRestore();
  });
});
