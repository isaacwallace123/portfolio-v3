import type { LearningSegment } from "../model/course";

// Segments 5–7. Where the abstractions stop being abstract: replicas become pods on named workers,
// the gateway becomes a tier with a bill, and a release becomes a traffic share.
//
// Segment 7 is the one part of the course with a second prerequisite. Progressive delivery is a
// release operation carried out through the request path, so it genuinely needs both the releases
// and the gateway material — reaching it early produces a lesson about canaries that assumes
// everything it is trying to teach.

export const schedulingAndMovement: LearningSegment = {
  id: "scheduling-and-movement",
  order: 5,
  title: "Scheduling and safe movement",
  summary:
    "A replica is a pod on a specific worker. Moving one is a replacement, and replacement without headroom is an outage you scheduled yourself.",
  domain: "scheduling",
  outcomes: [
    "Treat replicas as scheduled workloads rather than as an abstract number",
    "Recognise the risk of moving a single-replica service",
    "Create headroom before a drain",
    "Read pods distributed across worker pools during convergence",
    "Verify a migration from measured placement",
  ],
  prerequisites: ["read-the-system"],
  capstoneDrillId: "worker-evacuation",
  supportingDrillIds: ["pool-return"],

  lessons: [
    {
      id: "pods-workers-scheduling",
      title: "Pods, workers, and scheduling",
      summary:
        "Where a replica actually is, and why that is a measurement rather than an instruction.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "You asked for the checkout tier to move to the infra pool. Has it?",
          body: "Requesting a pool sets a preference for pods that are created from now on. What is running where is a separate fact, and during a migration the answer is usually 'some of each'.",
        },
        {
          kind: "model",
          title: "Pods land on workers",
          visual: "drain-migration",
          caption:
            "Each replica is a pod on a named worker in a named pool. A target pool is an intention; per-pod placement is the observation.",
        },
        {
          kind: "explanation",
          title: "Placement is per pod, not per service",
          idea: "A deployment does not move. Its pods are deleted on one node and created on another, one at a time.",
          example:
            "Halfway through an evacuation the tier legitimately has pods in both pools, and the fleet is serving from both.",
          watchFor:
            "The pool label on each pod. A pod still scheduling has no pool yet, which is different from being in the old one.",
        },
        {
          kind: "explanation",
          title: "Scheduling can fail quietly",
          idea: "If the target pool has no room, the new pods stay Pending. The old ones may already be gone.",
          example:
            "FailedScheduling on the replacements while the originals are terminating is how a migration turns into an outage.",
          watchFor:
            "Pending pods with a scheduling event. That is a refusal, and waiting will not resolve it.",
        },
        {
          kind: "summary",
          canDo: [
            "Read per-pod placement as the observed state of a migration",
            "Distinguish a pod that is scheduling from one that has been refused",
          ],
          drillId: "worker-evacuation",
        },
      ],
    },
    {
      id: "drains-and-headroom",
      title: "Why drains cause replacement, and headroom first",
      summary:
        "Draining does not relocate a running pod. It ends one and asks for another.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question:
            "A worker needs maintenance and one of your services has a single replica on it. What is the availability window?",
          body: "As long as it takes to start a replacement somewhere else — during which that service is serving nothing at all. Whether that window exists is entirely up to you, and it is decided before the drain, not during it.",
        },
        {
          kind: "guided-control",
          title: "One replica against three, drained side by side",
          visual: "drain-migration",
          caption:
            "Set the replica count and watch the drain. The same operation is an outage at one replica and a non-event at three.",
          control: {
            label: "Replicas before draining",
            min: 1,
            max: 4,
            step: 1,
            initial: 1,
            unit: "replicas",
          },
          observe:
            "At one replica the served line goes to zero and stays there until the replacement is ready. At three, the remaining two absorb the traffic and the line barely moves.",
        },
        {
          kind: "explanation",
          title: "Headroom converts an outage into a rolling change",
          idea: "With spare capacity, losing one pod is a capacity event the rest of the fleet absorbs. Without it, it is a total loss of the service.",
          example:
            "The worker-evacuation drill wants the tier moved without breaching the objective — which is only possible if you scale before you drain.",
          watchFor:
            "Served traffic during the move. If it dips below the objective, you did not create enough room first.",
        },
        {
          kind: "explanation",
          title: "The same rule keeps appearing",
          idea: "Create room, then move. It governs rollbacks, drains, rollouts and canary aborts alike.",
          example:
            "Rolling back a saturated tier and draining a single-replica worker are the same mistake wearing different clothes.",
          watchFor:
            "Any operation that replaces pods. Ask what is serving during the replacement before you start it.",
        },
        {
          kind: "check",
          check: {
            id: "c-sched-1",
            prompt:
              "Checkout has 2 replicas, both on the apps pool, serving 640 req/s of 640 offered at 78% CPU. You need everything off the apps pool. What first?",
            options: [
              {
                id: "a",
                label: "Scale up first, then change the target pool",
                correct: true,
                why: "At 78% CPU on two replicas there is no room to lose one. Extra capacity means the replacement cycle happens behind a fleet that is still serving the objective.",
              },
              {
                id: "b",
                label: "Change the target pool — Kubernetes handles the rest",
                correct: false,
                why: "It does handle it, by deleting a pod and creating another. With two replicas at 78% CPU, the remaining one cannot absorb the demand, and the objective breaches during the window.",
              },
              {
                id: "c",
                label:
                  "Drain the workers directly and let the scheduler place the pods",
                correct: false,
                why: "Same problem, less control. The capacity question is unchanged by which mechanism removes the pod.",
              },
              {
                id: "d",
                label: "Enable the cache so the tier needs fewer replicas",
                correct: false,
                why: "This does reduce load, but it changes two things at once during a migration and does not address the fact that pods are about to be replaced.",
              },
            ],
            takeaway:
              "Before any operation that replaces pods, ask what is left serving while the replacement starts.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Predict the availability window of a drain from the replica count and utilisation",
            "Create headroom as a deliberate first step rather than a reaction",
          ],
          drillId: "worker-evacuation",
        },
      ],
    },
    {
      id: "verifying-placement",
      title: "Verifying placement after migration",
      summary:
        "The migration is finished when every pod is measurably where it should be, and the objective never broke getting there.",
      estimatedMinutes: 4,
      blocks: [
        {
          kind: "context",
          question: "How do you know the evacuation is actually complete?",
          body: "By counting pods per pool, not by the target-pool field being set. The field is what you asked for; the count is what happened.",
        },
        {
          kind: "explanation",
          title: "Count pods per pool, not the intention",
          idea: "A migration is complete when zero pods remain in the pool you were leaving.",
          example:
            "A tier reading targetPool=infra with one pod still on apps is not evacuated. That last pod is the whole reason the maintenance was requested.",
          watchFor:
            "The per-pod pool labels. One straggler is easy to miss in an aggregate and is the only thing that matters here.",
        },
        {
          kind: "explanation",
          title: "Then put the capacity back",
          idea: "Headroom created for a move is not needed after it. Leaving it is a cost you took on for a window that has closed.",
          example:
            "The pool-return drill is about coming back cleanly: return the workload and the fleet size to where they should be, without breaching the objective on the way.",
          watchFor:
            "Scaling back down against the objective, one step at a time — the asymmetry from segment 2 applies here too.",
        },
        {
          kind: "check",
          check: {
            id: "c-sched-2",
            prompt:
              "Target pool reads infra. Pods: 3 on infra, 1 on apps, 1 with no pool yet. The objective is holding. What is the state?",
            options: [
              {
                id: "a",
                label:
                  "Still converging — one pod is scheduling and one has not been replaced",
                correct: true,
                why: "Five pods, three placed correctly, one still on the pool being evacuated and one in flight. The objective holding means the migration is going well, not that it is finished.",
              },
              {
                id: "b",
                label:
                  "Complete — the target pool is set and the objective holds",
                correct: false,
                why: "The target pool is the request. A pod is still running on apps, which is precisely the condition the evacuation exists to remove.",
              },
              {
                id: "c",
                label:
                  "Failed — a pod without a pool means scheduling was refused",
                correct: false,
                why: "A pod with no pool is one that has not been placed yet. A refusal comes with a FailedScheduling event; absence of a label is not evidence of one.",
              },
              {
                id: "d",
                label: "Over-provisioned — five pods for a three-pod tier",
                correct: false,
                why: "Extra pods during a migration are the headroom that is keeping the objective green. Reading them as waste mid-move is how the move breaks.",
              },
            ],
            takeaway:
              "Verify a migration by counting measured placement. Intention, aggregate health, and completion are three different things.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Confirm a migration from per-pod placement",
            "Return borrowed capacity after the window it was for has closed",
          ],
          drillId: "pool-return",
          watchFor:
            "The capstone wants the tier moved with the objective intact throughout. Watch the served line during the replacement window, not only at the end.",
        },
      ],
    },
  ],
};

export const gatewaysAndFlow: LearningSegment = {
  id: "gateways-and-flow",
  order: 6,
  title: "Gateways and request flow",
  summary:
    "The front door is a capacity tier with its own ceiling. Finding which side of it the queue is on decides whether any of your other options will work.",
  domain: "gateways",
  outcomes: [
    "Treat the gateway as a capacity tier rather than as plumbing",
    "Locate a queue by comparing offered, served, backend CPU and latency",
    "Explain why scaling the wrong side of the gateway has no effect",
    "Recognise a queue that has moved rather than disappeared",
  ],
  prerequisites: ["read-the-system"],
  capstoneDrillId: "gateway-saturation",
  masteryDrillId: "front-and-back",
  supportingDrillIds: [],

  lessons: [
    {
      id: "the-gateway-role",
      title: "The gateway's role",
      summary:
        "Envoy admits requests. Admission is a finite rate, and finite rates queue.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "Every backend replica is healthy and idle, and users are timing out. How?",
          body: "Because nothing is reaching them. A gateway at its own limit produces exactly this: a busy front door, a queue in front of it, and a perfectly healthy fleet with nothing to do.",
        },
        {
          kind: "model",
          title: "The queue is in front of the constrained tier",
          visual: "gateway-queue",
          caption:
            "Requests accumulate before whichever tier cannot admit them. Everything downstream of that point sees less traffic, not more.",
        },
        {
          kind: "explanation",
          title: "The gateway has replicas and CPU like anything else",
          idea: "It parses, routes, and forwards every request. That work has a cost per request and a ceiling per replica.",
          example:
            "On this platform a single gateway replica starts queueing around 2000 req/s regardless of how large the backend fleet is.",
          watchFor:
            "Gateway CPU as a share of its limit, read at the same time as backend CPU. The comparison is the diagnosis.",
        },
        {
          kind: "explanation",
          title: "Idle backends during high latency point forwards",
          idea: "A slow tier is a busy tier. A slow system with idle backends means the wait is happening before them.",
          example:
            "1600 offered, 610 served, gateway at 94%, checkout at 21% — the queue can only be at the front door.",
          watchFor:
            "The pair 'high latency, low backend utilisation'. It has essentially one explanation.",
        },
        {
          kind: "summary",
          canDo: [
            "Read the gateway as a capacity tier with its own utilisation",
            "Identify front-door saturation from idle backends",
          ],
          drillId: "gateway-saturation",
        },
      ],
    },
    {
      id: "finding-the-queue",
      title: "Finding the queue",
      summary: "Four numbers, read together, place the constraint every time.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "What is the shortest sequence of observations that locates a queue?",
          body: "Offered against served tells you a queue exists. Utilisation across the tiers tells you where. Latency confirms it is queueing rather than something slow. Nothing else is needed for the first decision.",
        },
        {
          kind: "metric-comparison",
          title: "Same shortfall, opposite fixes",
          caption:
            "Served is well below offered in both. The utilisation columns are what separate them, and they point at different tiers.",
          columns: ["Front door", "Back end"],
          rows: [
            { label: "Offered", left: "2400 req/s", right: "1600 req/s" },
            {
              label: "Served",
              left: "1980 req/s",
              right: "705 req/s",
              worse: 1,
            },
            {
              label: "Gateway CPU",
              left: "96% of limit",
              right: "34% of limit",
              worse: 0,
            },
            {
              label: "Checkout CPU",
              left: "28% of limit",
              right: "94% of limit",
              worse: 1,
            },
            { label: "p95 latency", left: "540 ms", right: "880 ms", worse: 1 },
            {
              label: "Correct action",
              left: "Scale the gateway",
              right: "Scale checkout",
            },
          ],
        },
        {
          kind: "explanation",
          title: "Scaling the unconstrained side is measurably nothing",
          idea: "Capacity added behind the ceiling never receives traffic. The signals do not deteriorate; they simply do not move.",
          example:
            "Six extra checkout replicas behind a saturated gateway come up ready and sit at low CPU while served traffic is unchanged.",
          watchFor:
            "A change with no measurable effect at all. That is information: it rules out the tier you just widened.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-gateway-1",
            prompt:
              "The gateway is saturated at 2400 req/s offered. You scale gateways from 1 to 3. What happens?",
            options: [
              { id: "a", label: "Served rises towards offered" },
              {
                id: "b",
                label: "Served rises, then stops short at a new ceiling",
              },
              { id: "c", label: "Nothing changes" },
              { id: "d", label: "Errors spike permanently" },
            ],
            actualOptionId: "b",
            because:
              "Relieving the front door lets the traffic through — to the backend, which now receives far more than it was getting. The queue does not disappear; it moves. That is the normal outcome of fixing the first constraint, and expecting it is what stops the second one from reading as a failed fix.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Place a queue from offered, served, and utilisation at both tiers",
            "Treat a change with no effect as evidence rather than as failure",
          ],
          drillId: "gateway-saturation",
        },
      ],
    },
    {
      id: "cascading-bottlenecks",
      title: "Cascading bottlenecks",
      summary:
        "Removing a constraint promotes the next one. Two tight tiers need two changes and one order.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "You fixed the gateway and served traffic only rose a little. Was the diagnosis wrong?",
          body: "Probably not. If the backend was also close to its limit, relieving the front door hands it more work than it can take, and the improvement stops at the new ceiling. The evidence for this is a tier that was idle and is now busy.",
        },
        {
          kind: "explanation",
          title: "The queue moves to the next narrowest point",
          idea: "A request path's capacity is its smallest tier. Widening that tier makes some other tier the smallest.",
          example:
            "The front-and-back drill has both tiers tight on purpose. Either change alone produces a partial improvement that looks like a wrong answer.",
          watchFor:
            "Utilisation at a tier that was previously idle. A tier waking up after your fix is the fix working.",
        },
        {
          kind: "explanation",
          title: "Re-diagnose after every change",
          idea: "The system after your action is a different system. The measurement that justified the last decision does not justify the next one.",
          example:
            "Gateway at 96% and checkout at 28% becomes gateway at 61% and checkout at 93%. Same incident, different constraint, different action.",
          watchFor:
            "Reading the tiers again before choosing. Acting twice from one diagnosis is how the wrong tier gets scaled second.",
        },
        {
          kind: "check",
          check: {
            id: "c-gateway-1",
            prompt:
              "Before: offered 2400, served 1010, gateway 97%, checkout 31%. You scale gateways to 3. After: served 1520, gateway 58%, checkout 95%. What now?",
            options: [
              {
                id: "a",
                label:
                  "Scale checkout — the constraint moved to it, exactly as expected",
                correct: true,
                why: "The gateway change did what it should: it relieved the front door and the traffic reached the backend, which is now the ceiling. Served rose by 500 req/s and the busy tier changed. Continue with the new diagnosis.",
              },
              {
                id: "b",
                label:
                  "Revert the gateway change — served is still below offered",
                correct: false,
                why: "The change produced a 50% improvement in served traffic and moved the constraint somewhere you can act on. Reverting it puts the original ceiling back.",
              },
              {
                id: "c",
                label: "Scale gateways further — 58% could still be the limit",
                correct: false,
                why: "58% is comfortable and checkout is at 95%. Adding capacity to the tier with headroom is the mistake this segment is about, and the measurement rules it out.",
              },
              {
                id: "d",
                label: "Enable the cache — the backend needs less work",
                correct: false,
                why: "Defensible if the load is database-bound, but nothing here says it is; checkout CPU is the constraint. Reach for the measurement that distinguishes them before choosing.",
              },
            ],
            takeaway:
              "A partial improvement plus a newly busy tier is a successful fix revealing the next constraint. Re-read the tiers after every change.",
          },
        },
        {
          kind: "check",
          check: {
            id: "c-gateway-2",
            prompt:
              "Which observation would most cheaply rule out the gateway as the constraint?",
            options: [
              {
                id: "a",
                label: "Gateway CPU as a share of its limit",
                correct: true,
                why: "One number, directly about the hypothesis, and capable of refuting it. Low gateway utilisation while requests are queueing somewhere means the queue is not here.",
              },
              {
                id: "b",
                label: "The number of gateway replicas",
                correct: false,
                why: "A count is not a load. One replica can be idle and three can be saturated; the replica count on its own says nothing about whether the tier is coping.",
              },
              {
                id: "c",
                label: "Total requests served since the run began",
                correct: false,
                why: "A cumulative figure rises in every scenario and describes no instant in particular.",
              },
              {
                id: "d",
                label: "Whether the gateway pods are Ready",
                correct: false,
                why: "A saturated gateway is Ready throughout. Readiness cannot distinguish coping from drowning.",
              },
            ],
            takeaway:
              "Prefer the single measurement that could falsify your hypothesis over the collection of measurements that would agree with it.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Expect and recognise a constraint moving after a correct fix",
            "Re-diagnose from fresh measurements before every subsequent action",
          ],
          drillId: "front-and-back",
          watchFor:
            "In the capstone, scale the front door and then read both tiers again. The second decision is a new diagnosis, not a continuation of the first.",
        },
      ],
    },
  ],
};

export const progressiveDelivery: LearningSegment = {
  id: "progressive-delivery",
  order: 7,
  title: "Progressive delivery",
  summary:
    "A canary limits how many people a bad build reaches. It does not make the build safe, and it does not stop it writing to the database.",
  domain: "progressive-delivery",
  outcomes: [
    "Explain how a stable fleet and a canary share traffic",
    "Use a canary to limit exposure rather than to eliminate risk",
    "Abort a bad canary and replace the capacity the abort removed",
    "Recognise that a canary can still write real data",
  ],
  prerequisites: ["releases-and-rollouts", "gateways-and-flow"],
  capstoneDrillId: "canary-catch",
  supportingDrillIds: ["canary-first", "canary-and-fleet"],

  lessons: [
    {
      id: "full-rollout-versus-canary",
      title: "Full rollout versus canary",
      summary:
        "Traffic share follows replica share. That single fact is most of progressive delivery.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "You are shipping a build you are not certain about. How many people should see it first?",
          body: "As few as will still tell you whether it works. That number is not zero — a canary nobody uses proves nothing — and it is set by replica count, because that is what decides the traffic share.",
        },
        {
          kind: "model",
          title: "One endpoint, two fleets",
          visual: "canary-split",
          caption:
            "The gateway distributes across all ready pods. Two canary replicas beside six stable ones is a quarter of your traffic on the candidate build.",
        },
        {
          kind: "explanation",
          title: "Exposure is replicas, not a percentage setting",
          idea: "There is no separate traffic-split dial here. Share is a consequence of how many pods of each build are ready.",
          example:
            "6 stable and 2 canary is 25% exposure. Adding two more stable replicas drops the canary's share to 20% without touching the canary.",
          watchFor:
            "Both counts. Reasoning about the canary's share from the canary alone gets the arithmetic wrong.",
        },
        {
          kind: "explanation",
          title: "The canary's error rate is diluted in the total",
          idea: "A headline error rate blends both fleets. A canary failing badly can look like a mild overall problem.",
          example:
            "A canary failing 40% of its requests at 25% exposure reads as roughly 10% overall — bad enough to notice, mild enough to misattribute.",
          watchFor:
            "The release identifier on failing traces. Attribution matters more here than the headline number.",
        },
        {
          kind: "summary",
          canDo: [
            "Compute exposure from stable and canary replica counts",
            "Attribute a blended error rate to the fleet actually producing it",
          ],
          drillId: "canary-first",
        },
      ],
    },
    {
      id: "abort-observe-recover",
      title: "Abort, observe, and recover",
      summary:
        "Aborting removes the bad build and the capacity it was providing. Both are consequences.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question:
            "The canary is bad. You take it to zero. Why did latency get worse?",
          body: "Because those replicas were serving real traffic — badly, but they were serving it. Removing them hands their share to a stable fleet that was sized for a smaller share.",
        },
        {
          kind: "explanation",
          title: "Dilution is not removal",
          idea: "Adding stable replicas reduces the canary's share of traffic. It does not stop the canary running or writing.",
          example:
            "Going from 25% to 10% exposure means fewer affected users per second and the same fault still in production.",
          watchFor:
            "Whether the canary replica count actually reached zero. Improvement from dilution is easy to mistake for a fix.",
        },
        {
          kind: "explanation",
          title: "Replace the capacity the abort removed",
          idea: "An abort is a scale-down of the total fleet. If the total was sized for the offered load, the remainder now is not.",
          example:
            "The canary-and-fleet drill is exactly this: abort correctly and the objective still breaches until the stable fleet is scaled to cover the gap.",
          watchFor:
            "Served against offered immediately after the abort. A shortfall there is capacity, not the canary.",
        },
        {
          kind: "explanation",
          title: "A canary writes real data",
          idea: "Limited exposure limits reads and writes proportionally — it does not make writes reversible.",
          example:
            "A canary with a data bug at 25% exposure has corrupted a quarter of the writes for as long as it ran. Removing it stops the bleeding and repairs nothing.",
          watchFor:
            "Data state after an abort. If the fault touched data, the abort is the first step and the recovery is the second.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-canary-1",
            prompt:
              "6 stable and 2 canary replicas are serving 800 req/s of 800 offered at 82% CPU. You take the canary to zero. What happens?",
            options: [
              { id: "a", label: "Errors fall and everything else holds" },
              {
                id: "b",
                label: "Errors fall and latency rises as the fleet shrinks",
              },
              { id: "c", label: "Nothing changes" },
              { id: "d", label: "The stable fleet scales up automatically" },
            ],
            actualOptionId: "b",
            because:
              "The abort was right and it removed a quarter of the serving capacity from a fleet already at 82% CPU. Six replicas now carry what eight were carrying. This is the moment a correct action looks like a mistake — and the answer is to replace the capacity, not to undo the abort.",
          },
        },
        {
          kind: "check",
          check: {
            id: "c-canary-1",
            prompt:
              "Canary at 2 replicas is failing 38% of its requests. Which action removes the fault?",
            options: [
              {
                id: "a",
                label: "Take the canary to zero replicas",
                correct: true,
                why: "The only action that stops the bad build serving. Expect a capacity shortfall immediately afterwards and plan to cover it.",
              },
              {
                id: "b",
                label: "Scale the stable fleet up to dilute the canary's share",
                correct: false,
                why: "This reduces exposure and improves the headline error rate while the faulty build keeps running and keeps writing. It is the masking pattern from segment 4 in a different tier.",
              },
              {
                id: "c",
                label: "Scale the canary up so it has more capacity",
                correct: false,
                why: "The failures are proportional to requests, not caused by a shortage. More canary replicas means more affected users.",
              },
              {
                id: "d",
                label: "Enable the cache to absorb the failing requests",
                correct: false,
                why: "A cache does not intercept application errors, and caching responses from a faulty build is a way to keep serving them after it is gone.",
              },
            ],
            takeaway:
              "Removal and dilution look similar in the headline numbers and are completely different operations. Only one of them stops the fault.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Abort a canary and anticipate the capacity gap the abort creates",
            "Tell dilution apart from removal in the measurements",
            "Check data state after aborting a build that could write",
          ],
          drillId: "canary-catch",
        },
      ],
    },
    {
      id: "exposure-and-error-budgets",
      title: "Traffic exposure and error budgets",
      summary:
        "How much risk a canary is actually taking, in requests rather than in feelings.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question: "Is 25% exposure for ten minutes acceptable?",
          body: "That is an arithmetic question before it is a judgement one. At 800 req/s it is 120,000 requests through an unproven build. Whether that is acceptable depends on the objective you are holding, and the number is the start of the conversation.",
        },
        {
          kind: "explanation",
          title: "Exposure is a rate multiplied by a duration",
          idea: "The cost of a canary is affected requests, which is share × offered load × time.",
          example:
            "2 of 8 replicas at 800 req/s for 10 minutes is 120,000 requests. Cutting exposure to 10% or the window to 2 minutes both change it by a lot.",
          watchFor:
            "How long the canary has been running. Exposure accumulates whether or not anyone is watching.",
        },
        {
          kind: "explanation",
          title: "The budget is what decides the abort threshold",
          idea: "An objective with an error clause converts an abort decision into a calculation.",
          example:
            "Against a 1% error objective, a canary failing 38% of its requests breaches the whole-system budget at any exposure above about 3%.",
          watchFor:
            "The blended error rate against the objective, and the canary's own rate against your tolerance for it. They answer different questions.",
        },
        {
          kind: "check",
          check: {
            id: "c-canary-2",
            prompt:
              "6 stable, 2 canary. The canary is failing 20% of its requests. What is the approximate blended error rate, and does it breach a 1% objective?",
            options: [
              {
                id: "a",
                label: "About 5% — yes, it breaches",
                correct: true,
                why: "The canary takes a quarter of the traffic and fails a fifth of that: 0.25 × 20% = 5%. Five times the objective, and the fact that three quarters of the fleet is perfect does not help the people in the other quarter.",
              },
              {
                id: "b",
                label: "About 20% — yes, it breaches",
                correct: false,
                why: "20% is the canary's own rate. The blended figure is weighted by traffic share, and the stable fleet is serving three quarters of it successfully.",
              },
              {
                id: "c",
                label: "About 2.5% — yes, it breaches",
                correct: false,
                why: "That would be the arithmetic for 12.5% exposure. Two of eight replicas is 25%.",
              },
              {
                id: "d",
                label: "About 5% — no, because only the canary is affected",
                correct: false,
                why: "The objective is about the service, and the service is what users call. A breach experienced by a quarter of requests is a breach.",
              },
            ],
            takeaway:
              "Blended error rate is the canary's rate weighted by its traffic share. Compute it before deciding whether the exposure is affordable.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Quantify canary exposure as affected requests over time",
            "Convert an error objective into an abort threshold",
          ],
          drillId: "canary-catch",
          watchFor:
            "The capstone wants the bad build gone and the objective held. Both, which means the abort and the capacity replacement are one plan rather than two decisions.",
        },
      ],
    },
  ],
};
