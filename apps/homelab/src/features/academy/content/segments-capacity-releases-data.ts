import type { LearningSegment } from "../model/course";

// Segments 2–4. The middle of the course: capacity, releases, and data.
//
// These reuse Segment 1's vocabulary rather than re-teaching it — offered versus served, desired
// versus observed, and "read three signals before naming a cause" are assumed from here on. Each
// segment carries three knowledge checks rather than two per lesson: the checkpoint is meant to be
// low-stakes, and a quiz after every page turns a course into a test.

export const capacityAndScaling: LearningSegment = {
  id: "capacity-and-scaling",
  order: 2,
  title: "Capacity and scaling",
  summary:
    "Demand, capacity, utilisation and saturation are four different things. Scaling only helps when you have identified which tier ran out of which one.",
  domain: "capacity",
  outcomes: [
    "Separate demand, capacity, utilisation and saturation",
    "Explain why adding replicas helps only at the constrained tier",
    "Account for cold start and convergence delay when judging a scale-out",
    "Right-size a fleet and understand why safe scale-down needs headroom",
    "Recognise more than one capacity constraint at the same time",
  ],
  prerequisites: ["read-the-system"],
  capstoneDrillId: "capacity-right-sizing",
  masteryDrillId: "front-and-back",
  supportingDrillIds: ["cold-start-storm", "checkout-traffic-spike"],

  lessons: [
    {
      id: "offered-versus-served",
      title: "Offered traffic versus served traffic",
      summary:
        "Four words that are used interchangeably in conversation and mean four different measurements.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question: "The tier is at 90% CPU. Is that a problem?",
          body: "It depends entirely on whether requests are waiting. Ninety percent utilisation with no queue is a well-sized fleet; ninety percent with a growing queue is an outage in progress. Utilisation alone cannot tell you which one you are looking at.",
        },
        {
          kind: "model",
          title: "Demand, capacity, and the gap",
          visual: "offered-vs-served",
          caption:
            "Demand is what arrives. Capacity is what the tier can produce. Utilisation is how much of capacity is in use. Saturation is what happens when demand exceeds it.",
        },
        {
          kind: "explanation",
          title: "Demand is set outside the system",
          idea: "Offered load comes from users, or here from the k6 generators. Nothing you do to the cluster changes it.",
          example:
            "Two generators offer 800 req/s regardless of whether checkout has one replica or six. Scaling changes what you can answer, never what you are asked.",
          watchFor:
            "Treating a drop in served traffic as a drop in demand. It is usually the opposite.",
        },
        {
          kind: "explanation",
          title: "Capacity is a property of the constrained tier only",
          idea: "A request path's capacity is the smallest capacity along it. Widening any other tier changes nothing measurable.",
          example:
            "Six uncached checkout replicas serve about 720 req/s. Behind a single saturated gateway they serve whatever the gateway admits, which is far less.",
          watchFor:
            "Utilisation across every tier at once. The constrained one is high; a well-chosen fix is the one that raises it.",
        },
        {
          kind: "explanation",
          title: "Saturation shows up as queueing, not as an error",
          idea: "A saturated tier keeps working. Requests take longer because they wait, and the waiting appears in the tail before it appears anywhere else.",
          example:
            "p95 climbing while the mean stays reasonable is the earliest reliable sign that a tier has run out of room.",
          watchFor:
            "p95 relative to target while served is still tracking offered. That is the warning before the ceiling, and it is the moment scaling is cheapest.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-capacity-1",
            prompt:
              "Checkout is at 45% CPU across six replicas and p95 is 640 ms. You add four more replicas. What happens to p95?",
            options: [
              { id: "a", label: "It falls by roughly a third" },
              { id: "b", label: "It barely moves" },
              { id: "c", label: "It falls to target" },
              {
                id: "d",
                label: "It rises while the new pods start, then falls",
              },
            ],
            actualOptionId: "b",
            because:
              "45% CPU means this tier is not the constraint — it has headroom and is still slow, so the wait is happening somewhere else. Ten replicas at 27% CPU is the same incident with a larger bill. The measurement to trust is utilisation at the tier you are about to scale.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "State demand, capacity, utilisation and saturation as four separate measurements",
            "Identify the constrained tier from utilisation rather than from suspicion",
          ],
          drillId: "capacity-right-sizing",
        },
      ],
    },
    {
      id: "horizontal-scaling-convergence",
      title: "Horizontal scaling and convergence",
      summary:
        "Replicas arrive one at a time, cold, and the first thing they do is make the tier slower.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question:
            "You scaled out correctly and latency got worse. Should you scale back?",
          body: "No — and doing so is one of the most reliable ways to turn a recoverable incident into a long one. Cold replicas cost something before they contribute, and the cost lands immediately while the benefit arrives over the following seconds.",
        },
        {
          kind: "guided-control",
          title: "Watch replicas schedule, start, and become ready",
          visual: "replica-convergence",
          caption:
            "Move the dial and watch each replica pass through scheduling and startup before it serves anything.",
          control: {
            label: "Desired replicas",
            min: 1,
            max: 6,
            step: 1,
            initial: 2,
            unit: "replicas",
          },
          observe:
            "The desired count changes instantly. Capacity arrives as a staircase, and the steps are not evenly spaced.",
        },
        {
          kind: "explanation",
          title: "Cold start is real work",
          idea: "A new pod is scheduled, its image is pulled if it is not cached on that node, the process starts, and only then does the readiness probe pass.",
          example:
            "The cold-start-storm drill exists because a simultaneous restart of an entire tier briefly leaves nothing serving — the worst possible moment to add more churn.",
          watchFor:
            "Ready count against desired count. Until they match, you have paid for capacity you cannot use yet.",
        },
        {
          kind: "explanation",
          title: "Scale in one decisive step, not in nervous increments",
          idea: "Each scaling action restarts the convergence you were waiting on and adds churn to a tier that is already struggling.",
          example:
            "Going 1 → 2 → 3 → 4 over a minute converges later and less predictably than going 1 → 4 once.",
          watchFor:
            "Your own hand. If you cannot say what measurement would tell you the last action worked, you are not ready to take the next one.",
        },
        {
          kind: "check",
          check: {
            id: "c-capacity-1",
            prompt:
              "Ten seconds after scaling checkout 1 → 4, served throughput has dropped and p95 is higher. What is the correct next action?",
            options: [
              {
                id: "a",
                label: "Wait, and watch the ready count reach 4",
                correct: true,
                why: "This is convergence. The single serving replica is now also handling the churn of three pods starting around it. Capacity arrives as they go ready, and the signals follow a few seconds after that.",
              },
              {
                id: "b",
                label: "Scale back to 1 — the change made it worse",
                correct: false,
                why: "That discards the fix at the exact moment it is most expensive and least visible, and adds a second round of churn. This is the most common way a correct action gets undone.",
              },
              {
                id: "c",
                label: "Scale to 8, since 4 was not enough",
                correct: false,
                why: "Nothing yet says 4 is not enough — none of the four are serving. Doubling an unconverged fleet doubles the startup cost that is currently the problem.",
              },
              {
                id: "d",
                label: "Enable the cache as well, immediately",
                correct: false,
                why: "Possibly useful later, but taking a second action before the first has been measured means you will not know which one worked, and both will be blamed if things get worse.",
              },
            ],
            takeaway:
              "A dip immediately after a correct scale-out is the shape of convergence. Judge the action when the ready count catches up, not before.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Predict the short-term cost of a scale-out and wait it out deliberately",
            "Choose one decisive scaling step over several nervous ones",
          ],
          drillId: "cold-start-storm",
        },
      ],
    },
    {
      id: "headroom-and-cost",
      title: "Headroom, right-sizing, and cost",
      summary:
        "Scaling down is an operational change with the same risks as scaling up, and none of the urgency that makes people careful.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question:
            "The incident is over and the fleet is three times the size it needs to be. How far down is safe?",
          body: "Far enough to stop paying for idle capacity, and not so far that the next ordinary fluctuation becomes an outage. That boundary is a measurement, not a preference.",
        },
        {
          kind: "explanation",
          title: "Headroom is the distance to the ceiling, in demand",
          idea: "Useful headroom is expressed as how much more traffic the tier could take, not as spare CPU percentage.",
          example:
            "Six replicas serving 400 req/s of an 720 req/s ceiling have room for another 320 req/s — most of another generator's worth.",
          watchFor:
            "What p95 does as you remove replicas. It stays flat while there is headroom and turns upward the moment there is not.",
        },
        {
          kind: "explanation",
          title: "Scale down against the objective, not against the graph",
          idea: "The SLO defines how far you can go. Removing capacity is safe exactly while every condition still holds.",
          example:
            "The capacity-right-sizing drill asks for a smaller fleet that still serves the offered load inside the latency and error targets — both clauses, at once.",
          watchFor:
            "The objective list while you shrink. The first condition to go amber is the one that defines your floor.",
        },
        {
          kind: "explanation",
          title: "Removing a replica takes effect faster than adding one",
          idea: "Termination is quick and immediate; creation is slow and gradual. Scale-down is therefore the more dangerous direction despite feeling like the calmer one.",
          example:
            "Cutting six replicas to two removes two thirds of the capacity in seconds. Discovering that was too far costs a full cold start to undo.",
          watchFor:
            "Step down, measure, step down again. The asymmetry is the reason this is the one place incremental beats decisive.",
        },
        {
          kind: "check",
          check: {
            id: "c-capacity-2",
            prompt:
              "You are right-sizing. At 4 replicas: p95 is 148 ms, served 640/640 offered, CPU 71%. At 3 replicas: p95 is 244 ms, served 632/640, CPU 93%. The target is p95 under 250 ms. Which do you ship?",
            options: [
              {
                id: "a",
                label: "3 replicas — it meets the target and costs less",
                correct: false,
                why: "It meets the target with 6 ms to spare at 93% CPU. Any ordinary fluctuation breaches it, and you have removed the room needed to absorb one. Passing a threshold is not the same as being safely inside it.",
              },
              {
                id: "b",
                label: "4 replicas — the margin at 3 is inside the noise",
                correct: true,
                why: "148 ms against a 250 ms target with 29% CPU spare is a fleet that survives a bad minute. The saving from the fourth replica is small; the cost of being wrong is an SLO breach.",
              },
              {
                id: "c",
                label: "2 replicas, and enable the cache to compensate",
                correct: false,
                why: "Combining a cut with a compensating change means you cannot attribute the result to either. Establish the floor first; consider the cache as a separate, measured change.",
              },
              {
                id: "d",
                label: "Whichever has lower CPU — CPU is the real cost",
                correct: false,
                why: "Cost follows replica count here, not utilisation. High utilisation on few replicas is cheap and fragile; that trade is the actual decision, and it should be made on the latency margin.",
              },
            ],
            takeaway:
              "Right-sizing targets a comfortable margin, not the smallest fleet that technically passes. The margin is what absorbs the variance you have not seen yet.",
          },
        },
        {
          kind: "check",
          check: {
            id: "c-capacity-3",
            prompt:
              "Offered load is 1600 req/s. The gateway is at 88% CPU and checkout is at 91% CPU. Which is true?",
            options: [
              {
                id: "a",
                label:
                  "Both tiers are constrained; fixing one will expose the other",
                correct: true,
                why: "This is the front-and-back shape. Scaling checkout alone leaves the gateway as the new ceiling and served traffic barely moves; the honest read is that two changes are needed, and the second only becomes visible after the first.",
              },
              {
                id: "b",
                label: "The gateway is the constraint, because it comes first",
                correct: false,
                why: "Order in the path does not decide which tier is the ceiling. Both are near their limits, and relieving only the front door hands the queue to checkout.",
              },
              {
                id: "c",
                label: "Checkout is the constraint, because 91% is higher",
                correct: false,
                why: "Three percentage points is not a meaningful gap between two tiers that are both effectively full. Picking the higher number here is a coin flip dressed as analysis.",
              },
              {
                id: "d",
                label: "Neither — nothing is at 100%",
                correct: false,
                why: "Tiers queue well before 100%. Sustained utilisation in the high eighties with demand still arriving is saturation in practice.",
              },
            ],
            takeaway:
              "More than one tier can be constrained at once. When a correct fix produces a small improvement, suspect the next constraint rather than doubting the fix.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Express headroom as absorbable demand rather than as spare CPU",
            "Right-size against the objective with a deliberate margin",
            "Recognise two simultaneous constraints from utilisation at both tiers",
          ],
          drillId: "capacity-right-sizing",
          watchFor:
            "The capstone asks for a smaller fleet that still holds the objective. Find the floor by stepping down and measuring, then take one step back up.",
        },
      ],
    },
  ],
};

export const releasesAndRollouts: LearningSegment = {
  id: "releases-and-rollouts",
  order: 3,
  title: "Releases and rollouts",
  summary:
    "Telling a code regression from a capacity problem, and treating rollback as a production operation with a cost rather than a magic undo.",
  domain: "releases",
  outcomes: [
    "Distinguish a code regression from a capacity problem from the signals alone",
    "Treat rollback as an operation with convergence cost",
    "Recognise failures that appear only under production load",
    "Explain why scaling a broken release can hide symptoms without removing the cause",
  ],
  prerequisites: ["read-the-system"],
  capstoneDrillId: "release-under-load",
  supportingDrillIds: ["checkout-bad-release"],

  lessons: [
    {
      id: "stable-and-candidate",
      title: "Stable and candidate release tracks",
      summary:
        "Two builds of the same service, and how to find out which one answered a given request.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "Errors started at 14:02. A deploy went out at 14:01. Is that the cause?",
          body: "It is the obvious hypothesis and it is often right, which is exactly why it deserves evidence rather than assumption. The trace carries the release identifier; correlation in a timeline does not.",
        },
        {
          kind: "model",
          title: "Two tracks, one service name",
          visual: "release-tracks",
          caption:
            "Stable and candidate are separate sets of pods serving the same endpoint. Which one answered is a property of the request, not of the service.",
        },
        {
          kind: "explanation",
          title: "The release identifier lives in the trace",
          idea: "Every span carries the build that produced it. That is the difference between knowing which release is deployed and knowing which release served the failing request.",
          example:
            "During a partial rollout both identifiers appear. The proportion of each in the failing requests is the measurement that matters.",
          watchFor:
            "The release attribute on a recent trace, and whether the errors cluster on one identifier.",
        },
        {
          kind: "trace-example",
          title: "A trace from a failing request",
          caption:
            "Read from the top: the gateway forwarded, the candidate build handled it, and the failure is inside the pricing call rather than in the database beneath it.",
          spans: [
            {
              name: "GET /checkout",
              service: "envoy",
              durationMs: 412,
              depth: 0,
              status: "error",
            },
            {
              name: "handle checkout",
              service: "checkout@candidate",
              durationMs: 407,
              depth: 1,
              status: "error",
            },
            {
              name: "price basket",
              service: "checkout@candidate",
              durationMs: 391,
              depth: 2,
              status: "error",
            },
            {
              name: "SELECT catalogue",
              service: "postgres",
              durationMs: 9,
              depth: 3,
              status: "ok",
            },
          ],
        },
        {
          kind: "explanation",
          title: "A regression fails a proportion, not a quantity",
          idea: "Because every request runs the same code, the error rate of a bad build is roughly invariant to load.",
          example:
            "8% at 400 req/s stays about 8% at 800 req/s. Saturation errors, by contrast, appear only above the capacity ceiling and grow with demand.",
          watchFor:
            "Error rate as offered load changes. Flat means code; load-dependent means capacity.",
        },
        {
          kind: "summary",
          canDo: [
            "Attribute a failure to a specific build from a trace rather than from deploy timing",
            "Use the load-invariance of the error rate to separate code from capacity",
          ],
          drillId: "checkout-bad-release",
        },
      ],
    },
    {
      id: "failure-under-load",
      title: "Failure under production load",
      summary:
        "The bugs that pass every test are the ones that need concurrency, cache pressure, or a real dataset to appear.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "The candidate build was fine in staging and is failing in production. What is different?",
          body: "Usually concurrency, data volume, and the fact that production traffic is not evenly shaped. A regression that only appears above a certain request rate is not a mysterious one — it is a resource or locking problem that needed load to expose it.",
        },
        {
          kind: "explanation",
          title: "Load-dependent regressions look like capacity problems",
          idea: "A build that degrades under concurrency produces rising latency and errors as demand grows — the same shape as saturation.",
          example:
            "The release-under-load drill is built on exactly this ambiguity: the signals say capacity, and the release identifier says otherwise.",
          watchFor:
            "Utilisation at the tier. Saturation comes with high CPU; a locking or contention regression can be slow at modest CPU.",
        },
        {
          kind: "explanation",
          title:
            "Scaling a broken build spreads the failure rather than fixing it",
          idea: "Every new replica runs the same faulty code, so the proportion of failing requests is unchanged. Latency may improve, which makes it look like progress.",
          example:
            "Scaling from two to six replicas on a bad build can pull p95 back under target while the error rate does not move at all.",
          watchFor:
            "An improvement in one signal with no movement in another. A real fix moves the signal that actually described the fault.",
        },
        {
          kind: "explanation",
          title: "Rollback converges like any other rollout",
          idea: "Going back to stable replaces pods. There is a window where the tier is smaller than it was, and a cold start on the way out of it.",
          example:
            "Rolling back a saturated single-replica tier momentarily leaves nothing serving. Creating headroom first is what makes the rollback safe.",
          watchFor:
            "Served traffic during the rollback. A dip is expected; a dip that does not recover means something else is also wrong.",
        },
        {
          kind: "prediction",
          prediction: {
            id: "p-releases-1",
            prompt:
              "A candidate build is failing 6% of requests. You scale the tier from 2 to 6 replicas. What do the signals do?",
            options: [
              { id: "a", label: "Errors fall to about 2%, latency improves" },
              { id: "b", label: "Errors stay near 6%, latency improves" },
              { id: "c", label: "Errors and latency both stay flat" },
              {
                id: "d",
                label: "Errors rise, because there are more pods to fail",
              },
            ],
            actualOptionId: "b",
            because:
              "Latency improves because the work is spread over more CPU. The error rate does not, because it is a property of the code every replica is running. This split — one signal recovering, the other refusing to — is the clearest evidence you will get that you fixed the wrong thing.",
          },
        },
        {
          kind: "check",
          check: {
            id: "c-releases-1",
            prompt:
              "p95 is 620 ms, errors are 7.4%, checkout CPU is 38%, and the trace shows release=candidate. What is the fault, and what is the first action?",
            options: [
              {
                id: "a",
                label: "Capacity — scale checkout out",
                correct: false,
                why: "38% CPU rules out saturation. Scaling will pull latency down and leave the error rate exactly where it is, which costs you time and makes the next diagnosis harder.",
              },
              {
                id: "b",
                label: "A code regression — roll back to stable",
                correct: true,
                why: "A 7.4% error rate with the tier at 38% CPU and a candidate identifier in the trace is a regression, not a shortage. Rollback removes the cause; everything else manages the symptom.",
              },
              {
                id: "c",
                label: "Data corruption — recover the catalogue",
                correct: false,
                why: "The trace shows the database span succeeding in 9 ms. The failure is above it, in the code that called it.",
              },
              {
                id: "d",
                label: "Gateway saturation — add gateway replicas",
                correct: false,
                why: "Nothing here implicates the gateway, and errors returned by a failing backend are faithfully forwarded by a perfectly healthy front door.",
              },
            ],
            takeaway:
              "Moderate CPU with a high error rate points at code. The release identifier turns that inference into evidence.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Recognise a regression that only appears under production load",
            "Explain why more replicas do not repair bad code",
            "Plan a rollback around its convergence window",
          ],
          drillId: "release-under-load",
        },
      ],
    },
    {
      id: "rollbacks-and-convergence",
      title: "Rollbacks and rollout convergence",
      summary:
        "Order matters: headroom first, then the release change, then verification.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "You need to roll back a service that is already at its capacity limit. What do you do first?",
          body: "Make room. A rollback on a saturated tier removes serving capacity at the moment it is scarcest, and the resulting dip is easy to mistake for the rollback having made things worse.",
        },
        {
          kind: "explanation",
          title: "Sequence the operations so no step makes it worse",
          idea: "When two changes are both needed, the safe order is the one where every intermediate state is at least as good as the one before it.",
          example:
            "Add replicas, wait for ready, then roll back. Rolling back first leaves a smaller broken tier serving the same demand.",
          watchFor:
            "The ready count between the two steps. That pause is the whole point of doing them in order.",
        },
        {
          kind: "explanation",
          title: "Verification is a measurement, not a deploy event",
          idea: "The rollout completing is not evidence that the incident is over. The signals that described the fault have to return to normal and stay there.",
          example:
            "After a rollback, error rate is the signal to watch — it is the one that a scale-out could not have moved.",
          watchFor:
            "The specific signal your hypothesis predicted would change. If it does not move, the hypothesis was wrong even though the action succeeded.",
        },
        {
          kind: "check",
          check: {
            id: "c-releases-2",
            prompt:
              "Checkout is on a bad candidate build, running one replica, and saturated at 800 req/s offered. Which order is safest?",
            options: [
              {
                id: "a",
                label: "Roll back to stable, then scale out",
                correct: false,
                why: "The rollback replaces the single serving pod, so there is a window with nothing serving at all. It works eventually, but the intermediate state is the worst one available.",
              },
              {
                id: "b",
                label: "Scale out, wait for ready, then roll back to stable",
                correct: true,
                why: "Extra replicas absorb the demand, so the rollout can replace pods without the tier ever dropping to zero. Every intermediate state is better than the one before it.",
              },
              {
                id: "c",
                label: "Both at once, to save time",
                correct: false,
                why: "Two simultaneous changes converge together and you cannot attribute the result to either. It is also the case that scale-out and rollout compete for the same startup capacity.",
              },
              {
                id: "d",
                label: "Enable the cache first to reduce load, then roll back",
                correct: false,
                why: "The cache reduces database work; it does not stop the broken code from running, and it delays the action that actually removes the fault.",
              },
            ],
            takeaway:
              "Create headroom before you move something. It is the same rule that governs draining a worker, and it is the reason both are in this course.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Sequence two necessary changes so no intermediate state is worse",
            "Verify a rollback from the signal that described the fault",
          ],
          drillId: "release-under-load",
          watchFor:
            "The capstone's fault only shows at load. Check the release identifier before you conclude the tier is simply too small.",
        },
      ],
    },
  ],
};

export const dataAndCaching: LearningSegment = {
  id: "data-and-caching",
  order: 4,
  title: "Data and caching",
  summary:
    "Application health and data correctness are different claims. A cache can make the first look excellent while the second is broken.",
  domain: "data",
  outcomes: [
    "Distinguish application health from data correctness",
    "Explain what caching can and cannot repair",
    "Recognise symptom masking",
    "Explain why more application replicas do not repair corrupt data",
    "Recover data and verify the result through live traffic",
  ],
  prerequisites: ["read-the-system"],
  capstoneDrillId: "catalogue-data-recovery",
  supportingDrillIds: ["catalogue-cache-mask", "double-fault"],

  lessons: [
    {
      id: "the-data-tier",
      title: "The data tier in the request path",
      summary:
        "Postgres is the source of truth. Everything above it is a copy with an expiry date.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "Checkout is fast and returning 200s. Are customers seeing the right prices?",
          body: "Nothing in latency or status codes answers that. A service can serve wrong data quickly and successfully, and every signal on the dashboard will look excellent while it does.",
        },
        {
          kind: "model",
          title: "Cache between the application and the truth",
          visual: "cache-flow",
          caption:
            "A hit is answered from Redis and never reaches Postgres. A miss goes through to the database. Which path a request took decides what it could possibly have observed.",
        },
        {
          kind: "explanation",
          title: "Correctness is not a performance signal",
          idea: "Throughput, latency and HTTP status describe delivery. None of them describe whether the delivered value was right.",
          example:
            "A corrupt catalogue can serve every request in 40 ms with a 200 status. The error rate only moves if the application itself notices and fails.",
          watchFor:
            "The data state as its own signal, separate from the performance signals. On this platform it reads healthy, degraded, or recovered.",
        },
        {
          kind: "explanation",
          title: "Replicas multiply reads of the same data",
          idea: "Scaling the application tier changes how much work can be done, not what the data says.",
          example:
            "Six replicas reading a corrupt catalogue produce six times as many wrong answers per second.",
          watchFor:
            "Whether your action touches the tier your hypothesis blamed. If the hypothesis is 'the data is wrong', no replica count is a fix.",
        },
        {
          kind: "summary",
          canDo: [
            "Read data state as a signal independent of latency and errors",
            "Explain why application scaling cannot repair data",
          ],
          drillId: "catalogue-data-recovery",
        },
      ],
    },
    {
      id: "cache-masking",
      title: "Caching, masking, and stale reads",
      summary:
        "The cache is a load-reduction tool that happens to also be an excellent way to hide a data incident from yourself.",
      estimatedMinutes: 6,
      blocks: [
        {
          kind: "context",
          question:
            "You enabled the cache and the error rate dropped. Did you fix the incident?",
          body: "You reduced how often the broken thing is consulted. Whether that counts as a fix depends entirely on what was broken — and if it was the data, you have made the problem harder to see without making it smaller.",
        },
        {
          kind: "explanation",
          title: "A cache removes work, and work is where problems are visible",
          idea: "Every hit is a request that did not exercise the database. Fewer observations of a broken tier means fewer symptoms, not fewer faults.",
          example:
            "The catalogue-cache-mask drill turns caching on over a degraded catalogue: the measured error rate improves and the data is exactly as wrong as it was.",
          watchFor:
            "An improvement in errors with no change in data state. That pairing is the definition of masking.",
        },
        {
          kind: "explanation",
          title: "Stale is a different failure from corrupt",
          idea: "Stale data was correct and is now out of date. Corrupt data was never right. A cache produces the first and can conceal the second.",
          example:
            "Recovering the catalogue while the cache still holds corrupt entries means requests keep being answered wrongly from Redis until those entries expire.",
          watchFor:
            "Whether the fix has actually reached the requests. Verification has to come from live traffic after the recovery, not from the recovery succeeding.",
        },
        {
          kind: "explanation",
          title: "Caching is still the right answer sometimes",
          idea: "When the fault genuinely is load on the database, removing work is a real fix and often the cheapest one available.",
          example:
            "Above three generators the checkout tier cannot serve the offered load without the cache, however many replicas it has. There, enabling it is the correct move.",
          watchFor:
            "Postgres CPU. If it is high and the data is healthy, caching helps. If the data is degraded, caching hides.",
        },
        {
          kind: "check",
          check: {
            id: "c-data-1",
            prompt:
              "Error rate was 9%. You enabled the cache and it fell to 3%. Data state still reads degraded. What happened?",
            options: [
              {
                id: "a",
                label:
                  "Two thirds of requests are now answered from cache and never see the bad data",
                correct: true,
                why: "The fault is untouched — you changed how often it is consulted. The remaining 3% are the misses that still reach the corrupt catalogue, and every cached answer is wrong in a way nothing is now measuring.",
              },
              {
                id: "b",
                label: "The cache repaired the corrupt entries",
                correct: false,
                why: "A cache copies what it is given. It has no notion of correctness and cannot repair anything; if it was populated from a corrupt catalogue, it now holds corrupt values.",
              },
              {
                id: "c",
                label: "The remaining 3% is unrelated background noise",
                correct: false,
                why: "It is the miss rate hitting the same fault. Treating it as noise is how a data incident survives its own resolution.",
              },
              {
                id: "d",
                label: "The incident is resolved but the data label is lagging",
                correct: false,
                why: "Data state is a read of the actual catalogue, not a derived indicator. It says degraded because the catalogue is degraded.",
              },
            ],
            takeaway:
              "When an action improves a symptom and leaves the state that caused it unchanged, you have masked the incident. Check the tier your hypothesis blamed.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Recognise masking from an improving symptom beside an unchanged state",
            "Decide whether caching is a fix or a disguise from Postgres CPU and data state",
          ],
          drillId: "catalogue-cache-mask",
        },
      ],
    },
    {
      id: "recovery-and-verification",
      title: "Recovery and verification",
      summary:
        "The recovery succeeding and the customers being served correctly are two different events, in that order.",
      estimatedMinutes: 5,
      blocks: [
        {
          kind: "context",
          question:
            "The recovery job reported success. When can you say the incident is over?",
          body: "When live traffic is observably being answered from the recovered data. A job's exit code describes the job; only the request path describes what users get.",
        },
        {
          kind: "explanation",
          title: "Verify from traffic, not from the operation",
          idea: "Every layer between the fix and the user is a place the old behaviour can persist.",
          example:
            "Recovered catalogue, cache still warm with corrupt entries, error rate stays put. The recovery worked and nothing changed for anyone.",
          watchFor:
            "Error rate falling AND data state reading recovered, together, sustained. Either alone is incomplete.",
        },
        {
          kind: "explanation",
          title: "Two faults at once do not resolve one at a time neatly",
          idea: "When a data fault and a capacity fault coexist, fixing one moves some signals and not others, which reads as a partial failure.",
          example:
            "The double-fault drill exists for this: a correct data recovery leaves latency high because the tier is also too small, and it is tempting to conclude the recovery failed.",
          watchFor:
            "Which signals your action was supposed to move. Judge the action on those, then look for what remains.",
        },
        {
          kind: "check",
          check: {
            id: "c-data-2",
            prompt:
              "You recovered the catalogue. Data state reads recovered. Error rate has not moved. The cache is enabled. What is the most likely explanation?",
            options: [
              {
                id: "a",
                label:
                  "Requests are still being answered from cache entries populated while the data was corrupt",
                correct: true,
                why: "The recovery reached the database and the request path is not reading the database. Until those entries are gone, the fix exists and is invisible to users.",
              },
              {
                id: "b",
                label: "The recovery did not actually work",
                correct: false,
                why: "Data state is a read of the catalogue itself and it says recovered. Doubting the signal that just confirmed your action is the wrong instinct — look at what sits between it and the user.",
              },
              {
                id: "c",
                label: "The error rate metric is broken",
                correct: false,
                why: "Reaching for a broken metric is almost always premature. There is a straightforward causal explanation on the table that fits every observation.",
              },
              {
                id: "d",
                label: "The application needs more replicas",
                correct: false,
                why: "Nothing suggests a capacity shortage, and more replicas would read the same cache.",
              },
            ],
            takeaway:
              "A fix is not delivered until the request path is actually exercising it. Verify at the edge, not at the tier you changed.",
          },
        },
        {
          kind: "summary",
          canDo: [
            "Verify a data recovery from live traffic rather than from the operation's result",
            "Keep going when a correct action leaves some signals unmoved",
          ],
          drillId: "catalogue-data-recovery",
          watchFor:
            "The capstone's objective includes both the recovered data state and a live error rate. Both, held together.",
        },
      ],
    },
  ],
};
