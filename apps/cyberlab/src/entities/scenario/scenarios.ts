import type { CaseStudy } from "./types";
import { recordingToCaseStudy } from "./recording";

import coffeeShop from "@/content/scenarios/coffee-shop-breach.json";
import kaliRecon from "@/content/scenarios/kali-recon.json";
import exampleRecording from "@/content/recordings/example-local-recon.recording.json";

// Scripted case studies are authored directly in the CaseStudy shape.
const scripted: CaseStudy[] = [coffeeShop as CaseStudy, kaliRecon as CaseStudy];

// Captured case studies come from real cyberlab-recording/1 files run through the adapter. This one
// is a genuine local capture (player.py --record) included to prove the Phase 1 → Phase 2 pipeline;
// the first real lab capture (Kali over Guacamole) drops in here the same way.
const captured: CaseStudy[] = [
  recordingToCaseStudy(exampleRecording, {
    summary:
      "A genuine capture from player.py --record: a short host-recon run, replayed from its recorded command output and timing rather than a script.",
    purpose:
      "Proof that the recording pipeline is real — this case study was not hand-written. It is the same format the live lab captures produce, so a real Kali engagement becomes a case study with no extra work.",
    tags: ["captured", "recording", "reconnaissance", "single-actor"],
  }),
];

const ALL: CaseStudy[] = [...scripted, ...captured];

export function getCaseStudies(): CaseStudy[] {
  return ALL;
}

export function getCaseStudy(id: string): CaseStudy | undefined {
  return ALL.find((s) => s.id === id);
}

export function getFeatured(): CaseStudy[] {
  // The multi-actor breach leads; it best shows what the range is for.
  return [
    getCaseStudy("coffee-shop-breach"),
    getCaseStudy("kali-recon"),
  ].filter((s): s is CaseStudy => Boolean(s));
}
