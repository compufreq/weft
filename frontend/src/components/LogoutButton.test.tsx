import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthStatus } from "./AuthGate";
import LogoutButton from "./LogoutButton";

const renderWith = (status: AuthStatus | null, logout = vi.fn().mockResolvedValue(undefined)) => {
  render(() => (
    <AuthContext.Provider value={{ status: () => status, logout }}>
      <LogoutButton />
    </AuthContext.Provider>
  ));
  return logout;
};

describe("LogoutButton", () => {
  it("is hidden when the deployment has no auth", () => {
    renderWith({ auth_required: false, authorized: true, read_only: false });
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("is hidden while unauthorized (token gate showing)", () => {
    renderWith({ auth_required: true, authorized: false, read_only: false });
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("is hidden before auth status has loaded", () => {
    renderWith(null);
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("is hidden outside an AuthContext provider", () => {
    render(() => <LogoutButton />);
    expect(screen.queryByRole("button", { name: /log out/i })).not.toBeInTheDocument();
  });

  it("shows for an authorized session and calls logout on click", () => {
    const logout = renderWith({ auth_required: true, authorized: true, read_only: false });
    const button = screen.getByRole("button", { name: /log out/i });
    fireEvent.click(button);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
