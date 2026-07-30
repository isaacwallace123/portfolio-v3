import { describe, expect, it } from "vitest";
import { motionAllowed } from "./motion";

// The Academy's animations ARE the explanation, so "reduced motion" cannot mean "play it faster".
// It means: render the settled, explained state. This is the decision that routes to that, and it
// has to honour both the OS preference and the site's own toggle — a learner who turned the site
// setting on should not have to also change their operating system.

const root = (attributes: Record<string, string>) => ({
  getAttribute: (name: string) => attributes[name] ?? null,
});

describe("motionAllowed", () => {
  it("allows animation when neither signal objects", () => {
    expect(motionAllowed(root({}), false)).toBe(true);
  });

  it("refuses when the OS asks for reduced motion", () => {
    expect(motionAllowed(root({}), true)).toBe(false);
  });

  it("refuses when the site's own preference is set", () => {
    expect(motionAllowed(root({ "data-reduce-motion": "" }), false)).toBe(
      false,
    );
    expect(motionAllowed(root({ "data-reduce-motion": "true" }), false)).toBe(
      false,
    );
  });

  it("refuses when both signals are set", () => {
    expect(motionAllowed(root({ "data-reduce-motion": "" }), true)).toBe(false);
  });

  it("refuses before a root element exists, so the first paint is the static one", () => {
    // Server rendering has no document. Starting from "no animation" means a learner who never
    // gets the effect still sees a finished diagram rather than an empty first frame.
    expect(motionAllowed(null, false)).toBe(false);
  });
});
