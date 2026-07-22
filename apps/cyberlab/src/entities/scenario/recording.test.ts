import { describe, expect, it } from "vitest";
import realCapture from "@/content/recordings/example-local-recon.recording.json";
import { recordingToCaseStudy, ROLE_LABEL, rolesOf } from "./recording";
import type { CaseStudy } from "./types";

const META = { summary: "test summary", purpose: "test purpose", tags: ["t"] };

describe("recordingToCaseStudy", () => {
  it("converts the real bundled capture end to end", () => {
    const study = recordingToCaseStudy(realCapture, META);
    expect(study.recorded).toBe(true);
    expect(study.summary).toBe("test summary");
    expect(study.terminals.length).toBeGreaterThan(0);
    expect(study.steps.length).toBeGreaterThan(0);
    // every step must reference a terminal that exists
    const ids = new Set(study.terminals.map((t) => t.id));
    for (const s of study.steps) expect(ids.has(s.terminal)).toBe(true);
  });

  it("rejects documents that are not cyberlab-recording/1", () => {
    expect(() =>
      recordingToCaseStudy({ schema: "something-else" }, META),
    ).toThrow(/cyberlab-recording/);
  });

  it("rejects recordings without actors or steps", () => {
    expect(() =>
      recordingToCaseStudy(
        { schema: "cyberlab-recording/1", actors: [], events: [] },
        META,
      ),
    ).toThrow(/no actors/);
    expect(() =>
      recordingToCaseStudy(
        { schema: "cyberlab-recording/1", actors: [{ id: "a" }], events: [] },
        META,
      ),
    ).toThrow(/no replayable steps/);
  });

  it("groups events by step and formats detections as §-highlighted lines", () => {
    const study = recordingToCaseStudy(
      {
        schema: "cyberlab-recording/1",
        scenario: { id: "synthetic", title: "Synthetic" },
        actors: [
          { id: "kali", role: "attacker" },
          { id: "soc", role: "responder" },
        ],
        events: [
          { step: 0, actor: "kali", kind: "narration", text: "Scan the box" },
          { step: 0, actor: "kali", kind: "command", text: "nmap -sV target" },
          {
            step: 0,
            actor: "kali",
            kind: "output",
            text: "80/tcp open\n22/tcp open",
          },
          {
            step: 1,
            actor: "soc",
            kind: "detection",
            source: "wazuh",
            rule_id: "5710",
            text: "Recon detected",
          },
        ],
      },
      META,
    );

    expect(study.id).toBe("synthetic");
    expect(study.steps).toHaveLength(2);
    expect(study.steps[0]).toMatchObject({
      terminal: "kali",
      say: "Scan the box",
      run: "nmap -sV target",
      out: ["80/tcp open", "22/tcp open"],
    });
    expect(study.steps[1].out).toEqual(["§[wazuh 5710] Recon detected§"]);
  });

  it("coerces unknown roles to operator", () => {
    const study = recordingToCaseStudy(
      {
        schema: "cyberlab-recording/1",
        actors: [{ id: "x", role: "haxxor" }],
        events: [{ step: 0, actor: "x", kind: "command", text: "whoami" }],
      },
      META,
    );
    expect(study.terminals[0].role).toBe("operator");
  });
});

describe("rolesOf", () => {
  it("returns roles deduped in first-seen order", () => {
    const study: CaseStudy = {
      id: "s",
      title: "s",
      summary: "s",
      terminals: [
        { id: "a", role: "attacker", title: "a", prompt: "$" },
        { id: "b", role: "responder", title: "b", prompt: "$" },
        { id: "c", role: "attacker", title: "c", prompt: "$" },
      ],
      steps: [],
    };
    expect(rolesOf(study)).toEqual(["attacker", "responder"]);
  });
});

describe("ROLE_LABEL", () => {
  it("labels the three hats and victim/operator", () => {
    expect(ROLE_LABEL.attacker).toBe("Black hat");
    expect(ROLE_LABEL.responder).toBe("White hat");
    expect(ROLE_LABEL.hardener).toBe("Red hat");
  });
});
