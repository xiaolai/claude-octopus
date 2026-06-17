import { describe, it, expect } from "vitest";
import { resolveSessionScope } from "./sessions.js";

describe("resolveSessionScope", () => {
  it("defaults to the server's working directory", () => {
    expect(resolveSessionScope({ defaultCwd: "/proj" })).toEqual({ dir: "/proj" });
  });

  it("honors an explicit cwd override", () => {
    expect(resolveSessionScope({ cwd: "/other", defaultCwd: "/proj" })).toEqual({
      dir: "/other",
    });
  });

  it("returns an undefined dir for all_projects (search everything)", () => {
    expect(resolveSessionScope({ allProjects: true, defaultCwd: "/proj" })).toEqual({
      dir: undefined,
    });
  });

  it("all_projects overrides an explicit cwd", () => {
    expect(
      resolveSessionScope({ allProjects: true, cwd: "/other", defaultCwd: "/proj" }),
    ).toEqual({ dir: undefined });
  });

  it("treats an empty-string cwd as unset and falls back to the default", () => {
    expect(resolveSessionScope({ cwd: "", defaultCwd: "/proj" })).toEqual({
      dir: "/proj",
    });
  });
});
