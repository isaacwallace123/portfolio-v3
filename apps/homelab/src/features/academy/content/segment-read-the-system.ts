import type { LearningSegment } from "../model/course";

// Segment 1 — Read the system.
//
// The one segment every other segment assumes. It is also the segment that decides whether the
// course teaches operations or teaches this website: everything here is about reading evidence, and
// nothing here rewards knowing which button the HomeOps arena happens to put where.
//
// The numbers quoted in the examples are the platform's real calibration, not round figures. One k6
// generator offers 400 requests a second; six uncached checkout replicas measurably serve about
// 720; one saturated replica sits near 930 ms at p95 and settles around 165 ms once the constraint
// is removed. Teaching with the numbers the cluster actually produces is what stops the lessons and
// the capstone disagreeing with each other.

export const readTheSystem: LearningSegment = {
  id: "read-the-system",
  order: 1,
  title: "Read the system",
  summary:
    "Where requests go, what the platform measures about them, and how an objective becomes something you can observe rather than assert.",
  domain: "observability",
  outcomes: [
    "Trace a request from the load generator through the gateway, application, cache, and database",
    "Tell desired state apart from observed state, and know which one a number is describing",
    "Read readiness, replicas, CPU, throughput, p95 latency, and error rate together rather than one at a time",
    "Treat an objective as a measured outcome instead of a sequence of actions",
    "Recognise that a component reporting healthy can still sit inside an unhealthy request path",
  ],
  prerequisites: [],
  capstoneDrillId: "checkout-traffic-spike",
  supportingDrillIds: [],

  lessons: [
    // ── 1 ────────────────────────────────────────────────────────────────
    {
      id: "the-request-path",
      title: "The HomeOps request path",
      summary:
        "Five tiers, one direction of travel, and why the slow one is rarely the one that looks broken.",
      estimatedMinutes: 7,
      blocks: [
        {
          kind: "context",
          question:
            "Checkout is slow. Is the application slow, or are requests never reaching it?",
          body: "Those two situations produce the same complaint and need opposite responses. Telling them apart is not a matter of judgement or experience — it is a matter of knowing which tiers a request passes through and what each one measures about it.",
        },
        {
          kind: "model",
          title: "One request, five tiers",
          visual: "request-path",
          caption:
            "A request enters at the load generator, is admitted by the gateway, is served by a checkout replica, and reaches the cache and the database behind it. Every tier is a place a request can wait.",
        },
        {
          kind: "explanation",
          title: "The generator offers load; it does not create capacity",
          idea: "The k6 generator runs an open-loop, constant-arrival-rate profile: it asks for a fixed number of requests a second whether or not anything answers. Offered load is demand. It never adapts to how the system is coping.",
          example:
            "One generator offers 400 requests a second. Two offer 800. If the stack can only serve 300, the generator still asks for 400 — the shortfall becomes queueing and errors, not a quieter generator.",
          watchFor:
            "Offered and served side by side. When they diverge, something downstream is the ceiling.",
        },
        {
          kind: "explanation",
          title: "The gateway is a capacity tier, not a wire",
          idea: "Envoy is easy to read as plumbing that simply forwards. It is a workload with replicas, CPU, and a finite admission rate, and it queues exactly like anything else.",
          example:
            "Past roughly 2000 requests a second the gateway itself becomes the constraint. Adding checkout replicas behind a saturated gateway changes nothing, because the extra replicas never receive traffic.",
          watchFor:
            "Backend replicas that are up, ready, and idle while latency is high. That combination almost always means the queue is in front of them.",
        },
        {
          kind: "explanation",
          title: "The application tier is where CPU shows up",
          idea: "Checkout replicas do the actual work. Each has a CPU limit, so a replica is not a unit of speed — it is a unit of concurrency with a ceiling.",
          example:
            "Six uncached checkout replicas measurably serve about 720 requests a second on this platform. A seventh adds throughput only if CPU is what was running out.",
          watchFor:
            "Per-pod CPU close to its limit across every replica. One hot pod is a scheduling story; every pod hot is a capacity story.",
        },
        {
          kind: "explanation",
          title: "The cache removes work; the database is the source of truth",
          idea: "Redis sits between checkout and Postgres. A cache hit means the database is never asked. That reduces load, and it also reduces how much the database's state is exercised.",
          example:
            "Turning the cache on can take a saturated stack back under its latency target without touching a single replica — because the work stopped happening, not because more capacity appeared.",
          watchFor:
            "Postgres CPU. If it drops when you enable caching, you have moved load. If error rate drops too, be suspicious: caching can hide a data problem rather than fix it.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-request-path-1",
            prompt:
              "The gateway is saturated. You scale checkout from one replica to four. What happens to served traffic?",
            options: [
              { id: "a", label: "It roughly quadruples" },
              { id: "b", label: "It rises a little, then flattens" },
              { id: "c", label: "It barely moves" },
              { id: "d", label: "It falls, because more replicas cost CPU" },
            ],
            actualOptionId: "c",
            because:
              "Served traffic is limited by whatever admits requests first. If the gateway is the ceiling, the new checkout replicas come up ready and then sit idle — the requests they would have served are still queued in front of the gateway. The fleet got more expensive and no faster.",
          },
        },
        {
          kind: "guided-control",
          title: "Raise the offered load and watch where the queue forms",
          visual: "queue-formation",
          caption:
            "Turn the dial up. Nothing here is being fixed — the point is to watch which tier stops keeping up first, and to notice that the tiers downstream of it go quiet rather than busy.",
          control: {
            label: "Offered load",
            min: 400,
            max: 2400,
            step: 400,
            initial: 400,
            unit: "req/s",
          },
          observe:
            "Below the ceiling, offered and served track each other and every tier is busy. Above it, served flattens, one tier's queue grows, and everything behind that tier gets quieter — starved, not healthy.",
        },
        {
          kind: "check",
          check: {
            id: "c-request-path-1",
            prompt:
              "Checkout p95 is 780 ms. You look at the tiers and see this. Where is the constraint?",
            evidence: [
              { label: "Offered", value: "1600 req/s" },
              { label: "Served", value: "610 req/s" },
              { label: "Gateway replicas", value: "1 · CPU 94% of limit" },
              {
                label: "Checkout replicas",
                value: "6 ready · CPU 21% of limit",
              },
              { label: "Postgres CPU", value: "12%" },
            ],
            options: [
              {
                id: "a",
                label:
                  "The checkout tier — six replicas is not enough for 1600 req/s",
                correct: false,
                why: "Six replicas would be a reasonable suspicion at this offered rate, but the measurement rules it out: they are at 21% CPU. A tier that is not working cannot be the tier that is overloaded.",
              },
              {
                id: "b",
                label:
                  "The gateway — it is at its CPU limit and the backend is idle",
                correct: true,
                why: "This is the signature: the front door pinned at its limit, served far below offered, and everything behind it underused because the requests never arrive. Scaling checkout here buys nothing.",
              },
              {
                id: "c",
                label: "Postgres — the database is always the real bottleneck",
                correct: false,
                why: "Postgres is at 12%. 'The database is always the bottleneck' is a heuristic, and the whole purpose of measurement is to beat heuristics when they are wrong.",
              },
              {
                id: "d",
                label: "There is not enough evidence to say",
                correct: false,
                why: "There is: one tier is at its limit, every other tier is idle, and served is well below offered. That is a complete story.",
              },
            ],
            takeaway:
              "A saturated tier is busy and the tiers behind it are quiet. Idle backends during high latency point forward, towards whatever is admitting the traffic — not backwards.",
          },
        },
        {
          kind: "check",
          check: {
            id: "c-request-path-2",
            prompt:
              "Every checkout pod reports Ready and the deployment shows 6/6. Users are still getting errors. What does Ready actually tell you?",
            options: [
              {
                id: "a",
                label:
                  "That the pods passed their own readiness probe, and nothing about the path in front of them",
                correct: true,
                why: "Readiness is a local claim: this container says it can accept a connection. It says nothing about whether traffic reaches it, whether the data it reads is correct, or whether the release it is running is the right one.",
              },
              {
                id: "b",
                label: "That the request path is healthy end to end",
                correct: false,
                why: "No tier can vouch for the tiers around it. Six ready replicas behind a saturated gateway, or running a broken release, are six ready replicas serving a broken experience.",
              },
              {
                id: "c",
                label: "That CPU and memory are within limits",
                correct: false,
                why: "Readiness and resource use are separate signals. A pod can be Ready and pinned at its CPU limit at the same time — that is exactly what a saturated tier looks like.",
              },
              {
                id: "d",
                label: "That the release is the stable one",
                correct: false,
                why: "A broken candidate build passes readiness perfectly well. Readiness checks that the process is alive and listening, not that it is correct.",
              },
            ],
            takeaway:
              "Readiness is a component's opinion of itself. A healthy component inside an unhealthy request path is the most common shape of a real incident.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Name the five tiers a HomeOps request passes through, in order",
            "Explain why offered load and served load are different numbers",
            "Locate a constraint from the combination of a busy tier and idle tiers behind it",
          ],
          drillId: "checkout-traffic-spike",
          watchFor:
            "In the capstone, read offered against served before you touch anything. The gap tells you how much capacity is missing; which tier is busy tells you where.",
        },
      ],
    },

    // ── 2 ────────────────────────────────────────────────────────────────
    {
      id: "desired-versus-observed",
      title: "Desired state versus observed state",
      summary:
        "Kubernetes accepts an intention immediately and satisfies it later. Nearly every confusing moment lives in that gap.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question:
            "You scaled checkout to four replicas ten seconds ago and throughput has not moved. Did the change fail?",
          body: "Almost certainly not. The control plane recorded your intention the moment you asked, and the cluster is still working through what that intention requires. The gap between the two is not a bug to route around — it is the thing you are operating.",
        },
        {
          kind: "model",
          title: "Two numbers for the same tier",
          visual: "desired-vs-observed",
          caption:
            "Desired is what you asked for and is true instantly. Observed is what the cluster has actually produced, and it arrives in pieces: scheduled, pulled, started, ready.",
        },
        {
          kind: "explanation",
          title: "Accepted is not the same as done",
          idea: "A scale request returns success when the API server has written the new desired count. Nothing has been scheduled yet at that point, let alone started.",
          example:
            "Scale checkout 1 → 4 and the deployment reads 4 desired, 1 ready within milliseconds. The other three go through scheduling, image pull, and startup before they serve anything.",
          watchFor:
            "The ready count catching up to the desired count. Until it does, you have asked for capacity you do not have yet.",
        },
        {
          kind: "explanation",
          title: "Convergence has a cost, and it is sometimes negative",
          idea: "Getting from one state to another is not free. Replacing pods means terminating ones that were serving, and starting ones that are cold.",
          example:
            "A rollout of a single-replica service momentarily has nothing serving. A cold-start storm — everything restarting at once — briefly makes latency worse than doing nothing would have.",
          watchFor:
            "A dip in served traffic immediately after a correct action. It is usually convergence, not a mistake — but you have to know that before you panic and act again.",
        },
        {
          kind: "explanation",
          title: "Measured signals lag the state that produced them",
          idea: "Throughput, latency, and error rate are computed over a window. When the underlying state changes, the window still contains the old world for a while.",
          example:
            "Four replicas can be ready and serving while p95 still reads high, because the p95 sample includes the seconds when there was one replica.",
          watchFor:
            "The direction of travel rather than the current value. A falling p95 that is still above target is a fix working; a flat one is not.",
        },
        {
          kind: "explanation",
          title: "The cluster can refuse, and refusal is also an observation",
          idea: "A desired state that the cluster will not satisfy does not fail loudly — it simply never converges. Quota limits and unschedulable pods look exactly like slowness until you read the events.",
          example:
            "Ask for more replicas than the namespace quota allows and the deployment reports the higher desired count forever while the extra pods are never created.",
          watchFor:
            "Pods stuck pending, and FailedCreate or FailedScheduling events. A pending pod that never moves has already been answered — the answer was no.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-desired-1",
            prompt:
              "You scale checkout from 1 to 4 replicas while it is saturated. What does served throughput do over the next thirty seconds?",
            options: [
              {
                id: "a",
                label: "Rises immediately and smoothly to the new ceiling",
              },
              {
                id: "b",
                label:
                  "Stays flat, then rises in steps as each replica goes ready",
              },
              {
                id: "c",
                label: "Drops first, then recovers past where it started",
              },
              {
                id: "d",
                label: "Nothing changes until you also restart the gateway",
              },
            ],
            actualOptionId: "b",
            because:
              "Each replica contributes only once it is Ready, and they do not become ready together. Throughput rises as a staircase, not a ramp — and the first step does not arrive at the moment you clicked.",
          },
        },
        {
          kind: "guided-control",
          title: "Request replicas and watch them converge",
          visual: "replica-convergence",
          caption:
            "Set a desired replica count and watch the observed count follow it. The delay is not decorative — it is the same delay a real scale-out has.",
          control: {
            label: "Desired replicas",
            min: 1,
            max: 6,
            step: 1,
            initial: 1,
            unit: "replicas",
          },
          observe:
            "Desired changes the instant you move the dial. Observed lags, arrives one pod at a time, and only then does capacity actually exist.",
        },
        {
          kind: "check",
          check: {
            id: "c-desired-1",
            prompt:
              "You scaled checkout to 5 replicas ninety seconds ago. The tier still reads 5 desired, 2 ready, and two pods are Pending with a FailedCreate event mentioning quota. What is true?",
            options: [
              {
                id: "a",
                label:
                  "The cluster has already refused; more waiting will not produce the replicas",
                correct: true,
                why: "FailedCreate against a quota is a decision, not a delay. The desired count will sit at 5 indefinitely while the namespace refuses to create the pods. You need a different plan, not more patience.",
              },
              {
                id: "b",
                label: "Convergence is slow; wait longer",
                correct: false,
                why: "Ninety seconds with an explicit refusal event is not slow convergence. Waiting is the right response to Pending with no event; it is the wrong response to Pending with a reason attached.",
              },
              {
                id: "c",
                label: "The desired count is wrong and should be re-applied",
                correct: false,
                why: "The desired count is exactly what you asked for and the control plane recorded it correctly. Re-applying the same intention gets the same refusal.",
              },
              {
                id: "d",
                label: "The two ready replicas are also at risk",
                correct: false,
                why: "Nothing here threatens the running pods. A quota refusal blocks new creation; it does not evict what already exists.",
              },
            ],
            takeaway:
              "A desired state the cluster will not satisfy stays desired forever. Read the events before you conclude that something is merely slow.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Separate what you asked for from what the cluster has produced",
            "Expect and explain the delay between a correct action and a measurable improvement",
            "Distinguish slow convergence from a refusal the cluster has already issued",
          ],
          drillId: "checkout-traffic-spike",
          watchFor:
            "After you scale, watch the ready count reach the desired count before you judge whether it worked. Acting again during convergence is how one incident becomes two.",
        },
      ],
    },

    // ── 3 ────────────────────────────────────────────────────────────────
    {
      id: "throughput-latency-errors",
      title: "Throughput, latency, and errors",
      summary:
        "Three numbers that only mean something together, and the specific ways each one lies on its own.",
      estimatedMinutes: 7,
      blocks: [
        {
          kind: "context",
          question:
            "Latency looks fine and the error rate is near zero. Is the system healthy?",
          body: "Not necessarily. Both of those numbers describe the requests that were served. Neither of them mentions the ones that were never admitted, and a system serving a tenth of its traffic beautifully can report excellent latency all day.",
        },
        {
          kind: "model",
          title: "Offered against served",
          visual: "offered-vs-served",
          caption:
            "The gap between what was asked for and what was answered is the signal none of the three headline numbers contains on its own.",
        },
        {
          kind: "explanation",
          title: "Throughput without offered load is meaningless",
          idea: "Served throughput is an output. Comparing it to demand turns it into a statement about whether the system is keeping up.",
          example:
            "610 req/s served sounds healthy until you learn 1600 were offered. The same 610 against 640 offered would be near-perfect.",
          watchFor:
            "Served as a share of offered. On this platform a drill counts as keeping up at 80% or better, because a two-second measurement window is never exactly the arrival rate.",
        },
        {
          kind: "explanation",
          title: "p95 describes the tail you actually feel",
          idea: "An average hides the slow requests inside the fast ones. The 95th percentile is the promise that nineteen requests in twenty were at least this quick.",
          example:
            "One saturated checkout replica measures around 930 ms at p95. With the constraint removed the same workload settles near 165 ms — and the SLO for these drills is 250 ms, comfortably between the two.",
          watchFor:
            "A p95 that is high while the mean is fine. That is a queue, and queues are about capacity rather than about code being slow.",
        },
        {
          kind: "explanation",
          title: "Errors tell you which kind of failure it is",
          idea: "A saturated system sheds load and a broken build returns 5xx, and those produce different shapes. Errors that scale with traffic are capacity; errors that stay constant as a proportion are code.",
          example:
            "A bad candidate release keeps its error rate roughly steady whether you offer 400 or 1600 req/s, because every request runs the same faulty path. Saturation errors appear only above the ceiling.",
          watchFor:
            "What happens to the error rate when demand changes. It is the cheapest test for capacity-versus-code you can run.",
        },
        {
          kind: "explanation",
          title:
            "The three of them move together, and the pattern is the diagnosis",
          idea: "Any one number is ambiguous. The combination usually is not.",
          example:
            "Served below offered with high p95 and low errors is a queue. Served tracking offered with steady errors and normal p95 is a code fault. Served below offered with a busy front door and idle backends is gateway saturation.",
          watchFor:
            "Reading all three before naming a cause. Naming the cause from one of them is how the wrong tier gets scaled.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-signals-1",
            prompt:
              "A candidate release is returning errors on 8% of requests at 400 req/s. You double offered load to 800 req/s without changing anything else. What does the error rate do?",
            options: [
              { id: "a", label: "Roughly doubles, to about 16%" },
              { id: "b", label: "Stays around 8%" },
              {
                id: "c",
                label: "Falls, because load is spread over more requests",
              },
              { id: "d", label: "Goes to zero once the cache warms" },
            ],
            actualOptionId: "b",
            because:
              "A code regression fails a fixed proportion of requests, because every request runs the same faulty path. The absolute number of failures doubles; the rate does not move. That invariance is precisely what distinguishes a bad release from a capacity problem — until you push past the capacity ceiling too, at which point both effects stack.",
          },
        },
        {
          kind: "metric-comparison",
          title: "Two incidents, same complaint",
          caption:
            "Both were reported as 'checkout is broken'. Reading three signals together separates them in one glance.",
          columns: ["Saturated tier", "Bad release"],
          rows: [
            { label: "Offered", left: "1600 req/s", right: "400 req/s" },
            {
              label: "Served",
              left: "610 req/s",
              right: "398 req/s",
              worse: 0,
            },
            { label: "p95 latency", left: "930 ms", right: "170 ms", worse: 0 },
            { label: "Error rate", left: "0.4%", right: "8.1%", worse: 1 },
            {
              label: "Checkout CPU",
              left: "96% of limit",
              right: "34% of limit",
            },
            { label: "Release", left: "stable", right: "candidate" },
          ],
        },
        {
          kind: "check",
          check: {
            id: "c-signals-1",
            prompt:
              "Which single piece of evidence would most quickly confirm a hypothesis of 'the checkout tier is capacity-constrained'?",
            options: [
              {
                id: "a",
                label: "Per-pod CPU across the checkout replicas",
                correct: true,
                why: "Capacity-constrained means the tier has run out of the resource it consumes. Every replica pinned near its CPU limit confirms it directly; any replica with headroom refutes it just as directly.",
              },
              {
                id: "b",
                label:
                  "The total number of requests served since the run started",
                correct: false,
                why: "A cumulative total does not describe the current rate, and rate is what saturation is about. It would go up in every scenario, including healthy ones.",
              },
              {
                id: "c",
                label: "The release identifier in a recent trace",
                correct: false,
                why: "That is excellent evidence — for the competing hypothesis. It tells you whether a bad build is running, not whether the tier is out of capacity.",
              },
              {
                id: "d",
                label: "Whether the pods report Ready",
                correct: false,
                why: "A saturated tier reports Ready throughout. Readiness cannot distinguish 'working flat out' from 'idle'.",
              },
            ],
            takeaway:
              "Good evidence is evidence that could come back negative. Pick the measurement that would change your mind, not the one that would agree with you.",
          },
        },
        {
          kind: "check",
          check: {
            id: "c-signals-2",
            prompt:
              "Served throughput is 300 req/s, p95 is 92 ms, error rate is 0.1%. Offered load is 1200 req/s. How would you describe this system?",
            options: [
              {
                id: "a",
                label:
                  "Healthy — latency and errors are both well inside target",
                correct: false,
                why: "This is the trap the lesson exists for. Latency and errors describe only the served requests. Three quarters of the demand is not represented in either number.",
              },
              {
                id: "b",
                label:
                  "Serving a quarter of its demand very well, which is a serious failure",
                correct: true,
                why: "Excellent latency on a fraction of the traffic is what a hard ceiling looks like from the inside. The 900 req/s that never got served produced no latency sample and no error, so the headline numbers look better the worse it gets.",
              },
              {
                id: "c",
                label: "Suffering a code regression",
                correct: false,
                why: "A regression would show in the error rate or the latency of the requests that were served. Both are clean; the problem is the requests that were not served at all.",
              },
              {
                id: "d",
                label: "Over-provisioned, since latency is so far under target",
                correct: false,
                why: "Backwards. Low latency here is a symptom of admitting too little work, not of having spare capacity.",
              },
            ],
            takeaway:
              "A system that drops load reports better latency and fewer errors as it gets worse. Always read served against offered first.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Read throughput as a share of demand rather than as a raw number",
            "Use p95 to identify queueing instead of general slowness",
            "Use the response of error rate to changing load to separate capacity from code",
          ],
          drillId: "checkout-traffic-spike",
          watchFor:
            "The capstone's objective is written against served throughput, p95 and errors together. Satisfying one while ignoring the others will not resolve it.",
        },
      ],
    },

    // ── 4 ────────────────────────────────────────────────────────────────
    {
      id: "objectives-that-measure",
      title: "How an objective becomes measurable",
      summary:
        "Why a drill ends when the cluster is genuinely in the target state, and why it has to hold.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question:
            "What would it take to prove that an incident is actually over?",
          body: "Not that you took the right action — that the system is in the state you claimed it would reach, and stayed there. Those are different claims, and only one of them is worth making to the people who were affected.",
        },
        {
          kind: "model",
          title: "Conditions, and the window they must hold for",
          visual: "goal-hold",
          caption:
            "Each condition is a measured signal against a threshold. The objective resolves only when every condition is satisfied continuously for the hold window.",
        },
        {
          kind: "explanation",
          title: "An objective names outcomes, not actions",
          idea: "A well-formed objective can be evaluated by someone who did not watch you work. It refers only to what the platform measures.",
          example:
            "'Serve the offered load with p95 under 250 ms and errors under 1%' is checkable from telemetry alone. 'Scale checkout and enable the cache' is a recipe, and a recipe cannot tell you whether it worked.",
          watchFor:
            "Objectives phrased as things to do. They are the reason people believe an incident is resolved while users are still failing.",
        },
        {
          kind: "explanation",
          title: "Thresholds have to be reachable and unreachable",
          idea: "A threshold is only useful if fixing the incident clears it and ignoring the incident does not.",
          example:
            "250 ms sits between the ~930 ms of a saturated tier and the ~165 ms of a healthy one. A 900 ms target would pass while broken; a 100 ms target would fail while fixed.",
          watchFor:
            "Targets that are round numbers rather than measured ones. They usually encode a hope rather than the workload's behaviour.",
        },
        {
          kind: "explanation",
          title: "The hold window is what rules out luck",
          idea: "Measured signals fluctuate. A single sample crossing a threshold can happen while the underlying problem is untouched.",
          example:
            "During convergence, throughput briefly spikes as pods come and go. A goal that resolved on one good sample would resolve in the middle of an outage.",
          watchFor:
            "How long the conditions have held, not just whether they are green right now. A condition that flickers has not been satisfied.",
        },
        {
          kind: "explanation",
          title: "Evaluation is server-side, and that matters",
          idea: "The platform judges the objective from its own measurements of your namespace. The browser is shown the verdict; it does not produce it.",
          example:
            "You cannot resolve a drill by convincing the page that things look fine. The same evaluation runs on every poll from the same telemetry the graph is drawn from.",
          watchFor:
            "The distinction between a lesson's illustrative diagram and the capstone's live goal list. One is a teaching example; the other is a measurement of your cluster.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-goals-1",
            prompt:
              "Every condition on the objective turns green. Two seconds later, one flicks back to red for one sample, then green again. What happens to the hold window?",
            options: [
              { id: "a", label: "It keeps counting; one sample is noise" },
              { id: "b", label: "It restarts from zero" },
              { id: "c", label: "The drill fails" },
              { id: "d", label: "It pauses and resumes where it left off" },
            ],
            actualOptionId: "b",
            because:
              "The conditions must hold continuously. A break restarts the window, because 'held for thirty seconds with a gap in the middle' is not the claim the objective makes. Nothing fails — you simply have not finished yet, and the page shows the window counting again.",
          },
        },
        {
          kind: "check",
          check: {
            id: "c-goals-1",
            prompt:
              "Which of these is a well-formed objective for an incident where checkout is saturated?",
            options: [
              {
                id: "a",
                label: "Scale checkout to at least four replicas",
                correct: false,
                why: "This is an action, and it might not even work — if the gateway is the constraint, four replicas satisfies this objective while users continue to fail.",
              },
              {
                id: "b",
                label:
                  "Serve at least 80% of offered load with p95 under 250 ms and errors under 1%, held for the verification window",
                correct: true,
                why: "Every clause is a measured signal with a threshold, it is checkable without knowing what you did, and it is only satisfiable by actually resolving the constraint.",
              },
              {
                id: "c",
                label: "Make checkout fast again",
                correct: false,
                why: "Nothing here is measurable. 'Fast' has no threshold and no window, so two people can disagree about whether it has been achieved.",
              },
              {
                id: "d",
                label: "Reduce p95 below 250 ms",
                correct: false,
                why: "Closer, but incomplete in a way that matters: a system dropping most of its traffic reports excellent p95. Without a throughput clause this passes during a severe outage.",
              },
            ],
            takeaway:
              "An objective is well-formed when it is measurable, complete enough that gaming one clause fails another, and holds over time.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Write an objective as measured outcomes with thresholds rather than as a list of actions",
            "Explain why a threshold has to sit between the broken and healthy measurements",
            "Read a hold window as evidence that a fix is stable rather than lucky",
          ],
          drillId: "checkout-traffic-spike",
          watchFor:
            "In the capstone, the objective list shows each condition's current value against its target and how long they have all held. That panel is the drill — the graph is just how you work out what to do about it.",
        },
      ],
    },
  ],
};
