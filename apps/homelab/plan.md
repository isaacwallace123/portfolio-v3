# HomeOps Academy

## Educational practice rework handoff

This document is the implementation handoff for rebuilding HomeOps Practice into a structured,
certificate-style learning product. It is intentionally detailed enough to begin implementation
without reinterpreting the product direction.

The desired product has two independent but connected experiences:

1. **HomeOps Academy** teaches production operations through short lessons, animated explanations,
   knowledge checks, guided labs, and real-cluster capstone drills.
2. **HomeOps Ranked** evaluates competitive operators through server-drawn, one-shot incidents,
   official time, and a persistent rating.

Practice and Ranked share the real Kubernetes arena engine. They must not share their navigation,
entry flow, instructional rules, result language, or progression model.

There are no seasons. Do not introduce seasonal resets, seasonal content, or season-specific data.

---

## 1. Ownership boundary

Claude owns the Academy and practice rework described in this document.

Primary Claude-owned areas:

```text
apps/homelab/src/app/practice/**
apps/homelab/src/features/academy/**
apps/homelab/src/features/drill/**
apps/homelab/src/widgets/practice-*/**
apps/homelab/src/widgets/academy-*/**
apps/api/Data/*Learning*
apps/api/Learning/**
```

Codex owns Ranked:

```text
apps/homelab/src/app/ranked/**
apps/homelab/src/features/ranked/**
apps/homelab/src/widgets/ranked-*/**
apps/homelab/src/app/api/live/ranked/**
apps/api/Data/*Ranked*
apps/api/Ranked/**
```

Shared files require care:

```text
apps/homelab/src/app/layout.tsx
apps/homelab/src/app/globals.css
apps/homelab/src/shared/api/live-client.ts
apps/homelab/src/shared/api/live-view.ts
apps/homelab/src/widgets/cluster-workbench/**
apps/api/Runs/RunBroker.cs
apps/api/Runs/LabRunModels.cs
```

If Academy needs a change in a shared file:

1. Keep the existing Ranked behavior working.
2. Add a stable shared primitive instead of importing Academy code into Ranked.
3. Do not rename or remove ranked fields, modes, routes, or API contracts.
4. Prefer additive props such as `surface`, `coaching`, or `presentation`.
5. Keep real-cluster evaluation server-authoritative.

---

## 2. Product vision

HomeOps Academy should feel like a focused cloud-operations course, inspired by the clarity and
progression of professional cloud training platforms without copying AWS branding or visual design.

It should feel:

- Structured enough to complete like a course
- Technical enough to be credible to an experienced engineer
- Friendly enough for someone learning production operations
- Visual and interactive rather than a wall of documentation
- Grounded in the real homelab rather than a fake browser simulation
- Worth showing on a portfolio as both teaching material and engineering work

The central promise:

> Learn the system, predict what it will do, then prove the skill on a real disposable cluster.

The Academy must teach transferable mental models. It must not teach learners to memorize which
button is correct for one hardcoded incident.

---

## 3. Information architecture

Recommended Academy routes:

```text
/practice
  Academy dashboard

/practice/path/production-operations
  Full course outline and progress

/practice/segment/[segmentId]
  Segment overview, lessons, checkpoint, and capstone

/practice/lesson/[lessonId]
  One focused interactive lesson

/practice/drill/[drillId]
  Briefing, preparation, real-cluster drill, and debrief

/practice/sandbox
  Open cluster workspace with no course objective

/practice/certificate
  Completion requirements and earned certificate
```

`/drills` may remain as a legacy redirect to `/practice`.

The top-level Practice dashboard must immediately answer:

- What course am I taking?
- How far through it am I?
- What should I learn next?
- Which operational skills have I demonstrated?
- Can I enter the open sandbox?

Do not make learners provision a cluster before they can browse the curriculum.

---

## 4. Course structure

Create one initial certificate track:

```text
Production Operations Foundations
```

The track contains seven segments. Each segment contains:

1. Two to four short lessons
2. One or two low-stakes knowledge checks
3. One guided interactive activity
4. One real-cluster capstone drill
5. A segment completion summary

The learner should understand the concept before spending cluster capacity.

### Segment 1 — Read the system

Learning outcomes:

- Understand the request path from load generator to gateway, application, cache, and database
- Distinguish desired state from observed state
- Read readiness, replicas, CPU, memory, throughput, p95 latency, and error rate
- Understand an SLO as an outcome rather than a button sequence
- Recognize that a healthy-looking component can still sit in an unhealthy request path

Lessons:

1. The HomeOps request path
2. Desired state versus observed state
3. Throughput, latency, and errors
4. How an objective becomes measurable

Interactive activity:

- Animate requests through the topology
- Let the learner raise offered traffic without applying fixes
- Ask them to identify where the queue forms

Capstone:

- `checkout-traffic-spike`

### Segment 2 — Capacity and scaling

Learning outcomes:

- Separate demand, capacity, utilization, and saturation
- Understand why adding replicas works only when the constrained tier is correct
- Recognize cold-start and convergence delay
- Understand right-sizing and why safe scale-down requires headroom
- Identify multiple simultaneous capacity constraints

Lessons:

1. Offered traffic versus served traffic
2. Horizontal scaling and convergence
3. Headroom, right-sizing, and cost
4. Front-door and backend bottlenecks

Guided activities:

- Predict the result of scaling checkout from one to four replicas
- Compare backend scaling with gateway scaling
- Scale down while watching SLO headroom

Capstone:

- Primary: `capacity-right-sizing`
- Optional mastery drill: `front-and-back`

Supporting practice:

- `cold-start-storm`

### Segment 3 — Releases and rollouts

Learning outcomes:

- Distinguish a code regression from a capacity problem
- Understand rollback as a production operation with convergence cost
- Recognize failures that appear only under load
- Understand why scaling a broken release can hide symptoms without removing the cause
- Observe restart and rollout consequences

Lessons:

1. Stable and candidate release tracks
2. Failure under production load
3. Rollbacks and rollout convergence
4. Why more replicas do not repair bad code

Interactive activity:

- Compare latency and errors for stable and candidate releases at low and high traffic
- Ask the learner to form a hypothesis before revealing the trace

Capstone:

- `release-under-load`

Supporting practice:

- `checkout-bad-release`

### Segment 4 — Data and caching

Learning outcomes:

- Distinguish application health from data correctness
- Understand what caching can and cannot repair
- Recognize symptom masking
- Explain why more application replicas do not repair corrupt data
- Recover data and verify the result through live traffic

Lessons:

1. The data tier in the request path
2. Caching as load reduction
3. Cache masking and stale or corrupt reads
4. Recovery and verification

Interactive activity:

- Toggle caching over healthy and degraded data
- Compare apparent error rate with actual data state
- Require the learner to identify the source of truth

Capstone:

- `catalogue-data-recovery`

Supporting practice:

- `catalogue-cache-mask`
- `double-fault`

### Segment 5 — Scheduling and safe movement

Learning outcomes:

- Understand replicas as scheduled workloads, not abstract numbers
- Recognize the risk of moving a single-replica service
- Create headroom before a drain
- Observe pods distributed across worker pools during convergence
- Verify a migration from measured placement

Lessons:

1. Pods, workers, and scheduling
2. Why drains cause replacement
3. Headroom before movement
4. Verifying placement after migration

Interactive activity:

- Animate a one-replica drain and a three-replica drain side by side
- Let the learner predict the availability window

Capstone:

- `worker-evacuation`

Supporting practice:

- `pool-return`

### Segment 6 — Gateways and request flow

Learning outcomes:

- Treat the gateway as a capacity tier
- Locate a queue by comparing offered traffic, served traffic, backend CPU, and latency
- Understand why scaling the wrong side of the gateway has no effect
- Recognize when a queue moves rather than disappears

Lessons:

1. The gateway’s role
2. Finding the queue
3. Front-door saturation
4. Cascading bottlenecks

Interactive activity:

- Visualize request accumulation before and after the gateway
- Scale the backend while the gateway remains constrained
- Highlight that extra backend replicas remain underused

Capstone:

- `gateway-saturation`

Supporting mastery:

- `front-and-back`

### Segment 7 — Progressive delivery

Learning outcomes:

- Understand stable fleet and canary traffic sharing
- Use a canary to limit exposure rather than eliminate risk
- Abort a bad canary
- Replace capacity removed by an abort
- Recognize that a canary can still write real data

Lessons:

1. Full rollout versus canary
2. Traffic exposure and error budgets
3. Abort, observe, and recover
4. The data consequences of partial exposure

Interactive activity:

- Change canary replicas and watch traffic share and error rate
- Compare dilution with actual removal of the bad build

Capstone:

- `canary-catch`

Supporting practice:

- `canary-first`
- `canary-and-fleet`

### Final certificate assessment

The course ends with a multi-domain, unranked assessment.

Recommended current scenario:

- `double-fault`

Longer-term, build a dedicated Academy assessment that combines:

- Evidence reading
- More than one fault
- A required hypothesis before action
- At least one convergence wait
- An after-action explanation

The final assessment is not Ranked. It may be retried and does not affect ELO.

---

## 5. Lesson page template

Every lesson should use the same predictable learning rhythm.

### A. Context

One concrete production question:

> Traffic doubled. Is the application slow, or are requests never reaching it?

Keep this to two or three sentences.

### B. Mental model

Show one visual model with no controls yet.

Examples:

- Request path diagram
- Replica scheduling animation
- Offered-versus-served chart
- Stable fleet beside canary
- Cache between checkout and data

Use labels in plain language first, with the infrastructure term immediately beside them.

### C. Explain

Use three to five short concept blocks. Each block must contain:

- One idea
- One concrete example
- One “watch for this” operational signal

Avoid long continuous prose.

### D. Predict

Before changing state, ask the learner what they expect:

```text
If checkout scales from one replica to four while the gateway is saturated,
what happens to served traffic?
```

Predictions should not punish the learner. They are used to make the animation meaningful.

### E. Demonstrate

Run a lightweight interactive explanation. This may be a deterministic teaching visualization and
does not need a real cluster when no real infrastructure skill is being assessed.

The visualization must label what is illustrative and what is live.

### F. Check

Ask one or two questions that test reasoning:

- Identify the constrained tier from signals
- Select which evidence would confirm a hypothesis
- Order two operations safely
- Explain why an apparently useful action does not address the cause

Do not ask trivia such as memorizing a port, numeric threshold, or product name.

### G. Transfer

End with:

- What the learner can now do
- Which live drill uses the skill
- What signal to look for during that drill

---

## 6. Practice drill redesign

Practice drills currently present an objective and a list of operator decisions. Preserve the real
cluster and server-side goal evaluation, but redesign the learning flow.

Every practice drill should have these phases:

```text
briefing
→ observe
→ hypothesize
→ act
→ watch consequence
→ verify recovery
→ debrief
```

### Briefing

Show:

- Incident title
- User impact
- Current SLO
- Known change or alert
- Skills being assessed
- Estimated lab time
- Whether the mode is Guided, Assisted, or Assessment

Do not reveal the correct action.

### Observe

The learner begins with the graph and evidence.

Require them to inspect or acknowledge the important evidence before decisions unlock. This should
replace arbitrary countdown language such as “unlocks in 10 seconds” wherever possible.

Examples of observable evidence:

- Offered traffic versus served traffic
- CPU at the constrained tier
- Release identifier in the trace
- Data state
- Actual worker placement
- Gateway utilization
- Canary error share

### Hypothesize

Ask:

```text
Where is the fault?
What evidence supports that?
What should change if your intervention works?
```

The hypothesis may be a lightweight selection, not free text. Its purpose is to teach diagnosis
before intervention.

Do not end the drill for a wrong hypothesis.

### Act

Actions must continue to map to real allowlisted changes applied by the API.

Present actions as operational changes, not quiz answers:

- Scale checkout to four replicas
- Roll back to stable
- Enable Redis cache
- Recover the catalogue
- Evacuate checkout to infra
- Scale Envoy gateways

The learner should feel that they are operating the platform, not answering multiple choice.

### Watch consequence

After every action:

- Acknowledge immediately that the control plane accepted it
- Highlight the affected tier
- Animate convergence
- Show the before and after desired state
- Show measured changes when they arrive
- Explain that measured signals can lag the requested state

For a wrong action, explain:

1. What changed
2. Why it did not address the cause
3. What signal proves that
4. How the learner can recover from the new state

Practice continues after a wrong action.

### Verify recovery

Keep the existing server-side objective and hold-time model.

Visually explain:

- Which conditions are satisfied
- Which condition remains open
- Why all conditions must hold continuously
- How long the verification window has held

The learner should understand that recovery is an observed outcome, not a correct-button flag.

### Debrief

The debrief is the core educational result screen.

Show:

- Outcome
- Timeline of hypotheses and actions
- Correct and unnecessary actions
- Before/after signals
- Time, but not as the only measure
- The causal chain
- Key lesson
- One recommended next lesson or drill
- Retry and continue buttons

Use language such as:

```text
You identified the application tier from high CPU and a served/offered shortfall.
Scaling checkout restored throughput. The gateway remained below saturation, which confirms it was
not the constraint.
```

Avoid a generic “correct / incorrect” summary.

---

## 7. Practice difficulty modes

Every Academy drill may be launched in one of three instructional presentations.

### Guided

- Evidence callouts
- Suggested order for inspection
- Explanations before actions
- Wrong actions continue
- Detailed debrief

### Assisted

- Objective and evidence available
- No suggested diagnosis
- Optional hints
- Wrong actions continue
- Detailed debrief

### Assessment

- No hints during the run
- Same real cluster
- Wrong actions continue unless the assessment explicitly requires a clean result
- Full explanation after completion
- Used for segment completion and the final certificate

These are presentation modes over the same practice scenario. They must not use the Ranked mode or
write ranked results.

---

## 8. Academy dashboard

The dashboard should have one primary action and three supporting regions.

### Primary region

```text
Production Operations Foundations
4 of 7 segments complete

Continue: Scheduling and safe movement
[Continue learning]
```

### Course map

Show the seven segments as a connected learning path, not an undifferentiated card grid.

States:

- Locked
- Available
- In progress
- Lessons complete, drill pending
- Complete
- Mastered

Do not hard-lock every segment in strict order. Recommended behavior:

- Segment 1 is required first
- Segments 2–6 become available after Segment 1
- Segment 7 requires Releases and Request Flow
- Final assessment requires all segments

### Skill profile

Show domain mastery:

- Observability
- Capacity
- Releases
- Data
- Scheduling
- Gateways
- Progressive delivery

This is Academy mastery, not ELO.

### Sandbox

Keep the open practice cluster available as a clearly separate option:

```text
Open sandbox
No objective, no course progress, no ranking.
```

---

## 9. Progress and persistence

Course progress must belong to the signed-in account.

Do not issue an account-level certificate based only on browser local storage.

Suggested entities:

### LearningCourseProgress

```text
Id
OwnerKey
CourseId
CourseVersion
StartedUtc
CompletedUtc
LastActivityUtc
```

### LearningUnitProgress

```text
Id
OwnerKey
CourseId
CourseVersion
UnitId
UnitType        lesson | checkpoint | drill | assessment
Status          available | in-progress | completed | mastered
Score
Attempts
BestElapsedMs
CompletedUtc
```

### LearningAttempt

```text
Id
OwnerKey
CourseId
UnitId
RunId
Presentation    guided | assisted | assessment
StartedUtc
CompletedUtc
Outcome
Missteps
ElapsedMs
```

Store course and unit versions. Completing version 1 remains a historical fact if lesson content is
changed later.

Suggested endpoints:

```text
GET  /v1/learning/courses
GET  /v1/learning/courses/{courseId}
GET  /v1/learning/progress
POST /v1/learning/units/{unitId}/start
POST /v1/learning/units/{unitId}/complete
GET  /v1/learning/certificate
```

The live cluster remains owned by the existing run APIs. Learning endpoints record curriculum
progress; they must not become a second cluster controller.

---

## 10. Certificate

Course completion should feel meaningful but remain honest about what it represents.

Name:

```text
HomeOps Certificate of Completion
Production Operations Foundations
```

Requirements:

- Complete every required lesson
- Score at least 80% across segment knowledge checks
- Complete every segment capstone
- Complete the final assessment
- At least five of seven capstones completed without a wrong operational action

Certificate fields:

```text
Learner display name
Course title
Course version
Issued date
Certificate identifier
Skills demonstrated
Verification URL
```

Do not call it an industry certification or imply endorsement by AWS, Kubernetes, CNCF, or another
external organization.

The certificate page should include:

- Clean printable layout
- Shareable public verification route using an opaque certificate identifier
- Download or print action
- List of demonstrated skills
- Link back to the live portfolio project

The certificate should not expire because there are no seasons. If the course receives a major new
version, the operator may optionally complete an update path.

---

## 11. Motion and visual teaching

Animations must explain system behavior.

Use motion for:

- Requests moving through the request path
- Offered traffic increasing
- A queue accumulating at the constrained tier
- Replicas being requested, scheduled, and becoming ready
- Pods draining from one worker pool and appearing on another
- Cache hit and miss paths
- Canary traffic splitting from the stable fleet
- Rollout replacement
- Objective conditions changing and holding

Avoid:

- Continuous decorative motion in reading sections
- Multiple competing animations
- Large parallax effects
- Animations that delay controls
- Motion that implies a real measurement when it is illustrative
- Confetti for every lesson completion

Motion hierarchy:

```text
Lesson concept understood       subtle confirmation
Knowledge check completed       short progress movement
Segment capstone completed      contained celebration
Course certificate earned       full achievement moment
```

Respect:

- `prefers-reduced-motion`
- Existing `data-reduce-motion`
- Existing contrast and transparency preferences
- Keyboard navigation
- Visible focus
- Screen-reader status announcements

Use SVG and CSS for diagrams that need exact labels and responsive behavior. Use the live graph for
real arena state. Do not use screenshots of the topology as teaching content.

---

## 12. Visual design

Preserve the HomeOps visual identity:

- Dark infrastructure background
- Mint/green as the Practice and Academy accent
- Amber for warnings and new incidents
- Red for observed degradation
- Monospace typography for measurements
- Sans-serif typography for explanations

Introduce an Academy layer:

- More breathing room than the arena
- Strong reading width
- Clear numbered segments
- Course progress line
- Large explanatory diagrams
- Restrained cards
- Consistent lesson navigation

Avoid turning the Academy into a dashboard containing dozens of equal cards.

At any moment there should be one obvious primary action:

- Continue lesson
- Check answer
- Start guided activity
- Prepare capstone
- Continue to next segment

---

## 13. Content data model

Do not hardcode every lesson directly inside one React page.

Suggested frontend content shape:

```ts
interface LearningCourse {
  id: string;
  version: number;
  title: string;
  summary: string;
  estimatedMinutes: number;
  segments: LearningSegment[];
}

interface LearningSegment {
  id: string;
  order: number;
  title: string;
  summary: string;
  outcomes: string[];
  prerequisites: string[];
  lessons: LearningLesson[];
  capstoneDrillId: string;
}

interface LearningLesson {
  id: string;
  title: string;
  estimatedMinutes: number;
  blocks: LearningBlock[];
  checks: KnowledgeCheck[];
}
```

Content may begin as typed TypeScript data. Keep the rendering engine separate from course content
so future lessons do not require new page components.

Recommended block types:

```text
context
explanation
request-path-diagram
metric-comparison
replica-animation
trace-example
prediction
knowledge-check
guided-control
summary
```

Do not build a general-purpose CMS in the first implementation.

---

## 14. Component architecture

Suggested structure:

```text
src/features/academy/
  model/
    course.ts
    progress.ts
    unlocks.ts
  content/
    production-operations.ts
  ui/
    AcademyDashboard.tsx
    CourseMap.tsx
    SegmentOverview.tsx
    LessonPlayer.tsx
    LessonNavigation.tsx
    KnowledgeCheck.tsx
    SkillProfile.tsx
    CertificateProgress.tsx
  visuals/
    RequestPathLesson.tsx
    CapacityQueueLesson.tsx
    SchedulingLesson.tsx
    CacheLesson.tsx
    CanaryLesson.tsx

src/widgets/practice-arena/
  PracticeArena.tsx
  PracticeBriefing.tsx
  EvidencePrompt.tsx
  HypothesisStep.tsx
  PracticeDebrief.tsx
```

Keep Academy lesson state separate from live run state.

Do not put course progress flags into `LiveRunView`. The run view describes the cluster. Learning
progress describes the course.

---

## 15. Existing functionality to preserve

The current system already has important behavior that must survive:

- Real disposable Kubernetes namespace
- Account ownership
- Resource quota and default-deny policy
- Live request, latency, error, resource, event, and trace data
- Per-pod placement
- Real allowlisted operator actions
- Server-side drill stage evaluation
- Goal hold verification
- Drill continuation after a practice misstep
- Visible before/after impact
- Cluster renewal and teardown
- Reload and resume of the account’s active cluster
- Reduced-motion support

The educational rework is not authorization to replace real telemetry with fake numbers.

Illustrative lesson visualizations may use deterministic teaching values only when clearly labeled
as examples. Capstone drill values must remain live.

---

## 16. Testing requirements

### Unit tests

- Course unlock rules
- Progress aggregation
- Certificate eligibility
- Knowledge-check scoring
- Course version handling
- Mapping of drills to segments

### Component tests

- Lesson navigation
- Keyboard-operable knowledge checks
- Retry and explanation states
- Reduced-motion rendering
- Segment progress state

### Integration tests

- Signed-in progress loads
- Lesson completion persists
- Segment capstone updates progress
- A practice result never changes Ranked data
- Refresh resumes the current lesson and current cluster independently
- Certificate is issued exactly once

### Live arena checks

- Wrong practice action continues the drill
- Affected service visibly changes
- Goal hold explains its progress
- Debrief receives the authoritative result
- Teardown still collects the cluster

---

## 17. Delivery phases

### Academy Phase A — Curriculum shell

- Build `/practice` Academy dashboard
- Add course and segment content data
- Add progress model in memory or mocked API shape
- Build course map and lesson player
- Keep the existing practice arena reachable

### Academy Phase B — First complete segment

Implement Segment 1 end to end:

- Lessons
- Animated request path
- Knowledge checks
- Real-cluster capstone
- Debrief
- Persisted progress

Do not build all seven segments before proving one complete vertical slice.

### Academy Phase C — Practice arena pedagogy

- Briefing
- Evidence gate
- Hypothesis step
- Consequence narration
- New debrief
- Guided, Assisted, and Assessment presentations

### Academy Phase D — Remaining curriculum

- Add Segments 2–7
- Reuse visual primitives
- Add skill profile
- Add recommendations

### Academy Phase E — Certificate

- Final assessment
- Eligibility rules
- Certificate generation
- Verification page
- Print layout

### Academy Phase F — Polish

- Motion pass
- Responsive pass
- Accessibility pass
- Content editing
- Performance and live-capacity checks

---

## 18. Definition of done

The Academy rework is complete when a new visitor can:

1. Understand that Practice is a structured course and Ranked is a separate competitive mode.
2. Begin a lesson without provisioning a cluster.
3. Learn one operational mental model through explanation and interaction.
4. Complete a meaningful knowledge check.
5. Launch a related capstone on a real Kubernetes workload.
6. Form a hypothesis before changing the system.
7. See the real effect of the chosen operation.
8. Receive a causal, evidence-backed debrief.
9. Return to a dashboard with saved progress.
10. Complete the course and receive an honest HomeOps certificate.

The rework is not done if it is only:

- A prettier drill list
- More text above the current decision buttons
- A collection of unrelated cards
- A fake simulation replacing the real cluster
- A certificate image with no persisted completion requirements

The intended result is a coherent learning product whose final labs prove skills against the same
real platform used by the competitive arena.
