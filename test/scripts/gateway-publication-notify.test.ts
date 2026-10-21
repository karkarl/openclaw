import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  notifyPublications,
  recordPublication,
} from "../../scripts/gateway-publication-notify.mjs";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const digest = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
const sourceCommit = "a".repeat(40);
const token = "synthetic-notification-token";
const publication = (name = "openclaw", version = "2026.9.9") => ({
  schema_version: 1,
  package_name: name,
  package_version: version,
  package_integrity: digest,
  source_repository: "openclaw/openclaw",
  source_commit: sourceCommit,
});
const registry = (value = publication()) =>
  Response.json({
    name: value.package_name,
    version: value.package_version,
    dist: { integrity: value.package_integrity },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gateway publication notification", () => {
  it("records each tarball's own version and bytes with the release source", async () => {
    const root = tempDirs.make("gateway-publication-");
    mkdirSync(join(root, "package"));
    const output = join(root, "outputs");
    for (const [name, version, key] of [
      ["openclaw", "2026.9.9", "openclaw_publication"],
      ["@openclaw/gateway-protocol", "2026.9.8-beta.1", "gateway_protocol_publication"],
    ]) {
      writeFileSync(join(root, "package", "package.json"), JSON.stringify({ name, version }));
      const archive = join(root, `${key}.tgz`);
      await tar.c({ cwd: root, file: archive, gzip: true }, ["package"]);
      await recordPublication(name, archive, sourceCommit, output);
      const line = readFileSync(output, "utf8").trim().split("\n").at(-1)!;
      expect(line.slice(0, line.indexOf("="))).toBe(key);
      expect(JSON.parse(line.slice(line.indexOf("=") + 1))).toEqual({
        ...publication(name, version),
        package_integrity: `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`,
      });
    }
    const recorded = readFileSync(output, "utf8");
    await expect(
      recordPublication(
        "openclaw",
        join(root, "gateway_protocol_publication.tgz"),
        sourceCommit,
        output,
      ),
    ).rejects.toThrow("package name differs");
    await expect(
      recordPublication("openclaw", join(root, "openclaw_publication.tgz"), "tooling-sha", output),
    ).rejects.toThrow("Invalid gateway publication");
    expect(readFileSync(output, "utf8")).toBe(recorded);
  });

  it.each(["openclaw", "@openclaw/gateway-protocol"])(
    "sends the exact v1 event for %s only to the fixed receiver",
    async (name) => {
      const value = publication(name, "2026.9.9-beta.1");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(registry(value))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);
      await notifyPublications([value], token);
      const [registryCall, dispatchCall] = fetchMock.mock.calls;
      if (!registryCall || !dispatchCall) {
        throw new Error("Expected exact registry readback followed by dispatch.");
      }
      expect(registryCall[0]).toBe(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/2026.9.9-beta.1`,
      );
      expect(registryCall[1]?.headers).toBeUndefined();
      const [url, init] = dispatchCall;
      expect(url).toBe("https://api.github.com/repos/openclaw/openclaw-windows-node/dispatches");
      expect(init).toMatchObject({
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (typeof init?.body !== "string") {
        throw new Error("Expected a JSON string dispatch body.");
      }
      expect(JSON.parse(init.body)).toEqual({
        event_type: "gateway-protocol-published",
        client_payload: value,
      });
    },
  );

  it.each([
    { package_name: "@openclaw/gateway-client" },
    { package_version: "latest" },
    { package_version: "^2026.9.9" },
    { package_version: "2026.9.9+build.1" },
    { package_integrity: "sha512-invalid" },
    { source_commit: "A".repeat(40) },
    { source_repository: "example/fork" },
    { schema_version: 2 },
    { unexpected: true },
  ])("rejects invalid identity before network access: %j", async (override) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(notifyPublications([{ ...publication(), ...override }], token)).rejects.toThrow(
      "Invalid gateway publication",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses missing App auth rather than falling back to ambient credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(notifyPublications([publication()], "")).rejects.toThrow("GitHub App token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: "@openclaw/gateway-protocol", version: "2026.9.9", dist: { integrity: digest } },
    { name: "openclaw", version: "2026.9.10", dist: { integrity: digest } },
    { name: "openclaw", version: "2026.9.9", dist: { integrity: "sha512-wrong" } },
  ])("refuses inconsistent registry readback: %j", async (metadata) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata));
    vi.stubGlobal("fetch", fetchMock);
    await expect(notifyPublications([publication()], token)).rejects.toThrow("differs");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 422, 500])(
    "reports rejected dispatch HTTP %s without retrying",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(registry())
        .mockResolvedValueOnce(new Response("Do not log untrusted response bodies", { status }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(notifyPublications([publication()], token)).rejects.toThrow(
        `Dispatch returned HTTP ${status}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("continues the other package after an ambiguous dispatch and records both outcomes", async () => {
    const protocol = publication("@openclaw/gateway-protocol", "2026.9.8");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(registry())
      .mockRejectedValueOnce(new Error(`transport detail must not expose ${token}`))
      .mockResolvedValueOnce(registry(protocol))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const summary = join(tempDirs.make("gateway-notification-summary-"), "summary");
    await expect(notifyPublications([publication(), protocol], token, summary)).rejects.toThrow(
      "Dispatch outcome is unconfirmed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const evidence = readFileSync(summary, "utf8");
    expect(evidence).toContain("openclaw@2026.9.9");
    expect(evidence).toContain("@openclaw/gateway-protocol@2026.9.8");
    expect(evidence).toContain("accepted by GitHub");
    expect(evidence).not.toContain(token);
  });

  it("attempts both packages when the job summary cannot be written", async () => {
    const protocol = publication("@openclaw/gateway-protocol", "2026.9.8");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(registry())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(registry(protocol))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const summary = tempDirs.make("gateway-notification-unwritable-summary-");
    await expect(notifyPublications([publication(), protocol], token, summary)).rejects.toThrow(
      "Could not write the gateway publication summary",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

type WorkflowJob = {
  needs?: string;
  if?: string;
  permissions?: Record<string, string>;
  "continue-on-error"?: boolean;
  outputs?: Record<string, string>;
  steps: {
    id?: string;
    run?: string;
    uses?: string;
    with?: Record<string, string>;
  }[];
};
const workflow = parse(readFileSync(".github/workflows/openclaw-npm-release.yml", "utf8")) as {
  jobs: {
    publish_openclaw_npm: WorkflowJob;
    notify_gateway_publication: WorkflowJob;
  };
};

describe("publication workflow notification boundary", () => {
  it.each([
    [
      "none",
      0,
      ["publish:protocol", "record:@openclaw/gateway-protocol", "publish:core", "record:openclaw"],
    ],
    [
      "record",
      0,
      ["publish:protocol", "record:@openclaw/gateway-protocol", "publish:core", "record:openclaw"],
    ],
    [
      "summary",
      0,
      ["publish:protocol", "record:@openclaw/gateway-protocol", "publish:core", "record:openclaw"],
    ],
    ["core", 23, ["publish:protocol", "record:@openclaw/gateway-protocol", "publish:core"]],
    ["protocol", 23, ["publish:protocol"]],
  ])("preserves publication sequencing when %s fails", (fault, status, expected) => {
    const root = tempDirs.make("gateway-publication-workflow-");
    mkdirSync(join(root, "preflight-tarball"));
    writeFileSync(join(root, "preflight-tarball", "protocol.tgz"), "");
    const script = workflow.jobs.publish_openclaw_npm.steps.find(
      (step) => step.id === "publish",
    )?.run;
    expect(script).toBeTruthy();
    const result = spawnSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        `
      npm() { return 1; }
      git() { printf '%040d\\n' 0; }
      jq() { printf '@openclaw/gateway-protocol\\tprotocol.tgz\\n'; }
      node() {
        if [[ "$1" == "-p" ]]; then echo 2026.9.9; return 0; fi
        [[ "$5" == "0000000000000000000000000000000000000000" ]] || return 27
        echo "record:$3"
        [[ "$FAULT" != record && "$FAULT" != summary ]]
      }
      bash() {
        case "$3" in
          *protocol.tgz) name=protocol ;;
          *) name=core ;;
        esac
        echo "publish:$name"
        if [[ "$FAULT" == "$name" ]]; then return 23; fi
      }
      ${script}
    `,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          FAULT: fault,
          GITHUB_SHA: "b".repeat(40),
          PUBLISH_TARBALL_PATH: "preflight-tarball/core.tgz",
          GITHUB_STEP_SUMMARY: fault === "summary" ? "preflight-tarball" : "summary",
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(status);
    expect(
      result.stdout.split(/\r?\n/u).filter((line) => /^(publish|record):/u.test(line)),
    ).toEqual(expected);
    if (fault === "record") {
      expect(result.stdout).toContain("::warning::");
      expect(readFileSync(join(root, "summary"), "utf8")).toContain("Do not republish");
    }
    if (fault === "summary") {
      expect(result.stdout).toContain("::warning::");
      expect(result.stdout).toContain("Could not write the notification warning summary");
    }
  });

  it("isolates downstream authority and admits recorded packages even after publish failure", () => {
    const publisher = workflow.jobs.publish_openclaw_npm;
    const notify = workflow.jobs.notify_gateway_publication;
    expect(notify.needs).toBe("publish_openclaw_npm");
    expect(notify["continue-on-error"]).toBe(true);
    expect(notify.permissions).toEqual({ contents: "read" });
    expect(notify.if).toContain("always()");
    expect(notify.if).not.toContain("needs.publish_openclaw_npm.result == 'success'");
    expect(publisher.outputs).toEqual({
      openclaw_publication: "${{ steps.publish.outputs.openclaw_publication }}",
      gateway_protocol_publication: "${{ steps.publish.outputs.gateway_protocol_publication }}",
    });
    const tokenStep = notify.steps.find((step) => step.id === "notification_token");
    expect(tokenStep?.with).toEqual({
      "client-id": "Iv23liOECG0slfuhz093",
      "private-key": "${{ secrets.CLAWSWEEPER_APP_PRIVATE_KEY }}",
      owner: "openclaw",
      repositories: "openclaw-windows-node",
      "permission-contents": "write",
    });
    expect(JSON.stringify(publisher)).not.toContain("CLAWSWEEPER_APP_PRIVATE_KEY");
  });
});
