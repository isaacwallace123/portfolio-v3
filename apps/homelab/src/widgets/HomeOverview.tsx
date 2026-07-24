"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  Cpu,
  GitPullRequest,
  MemoryStick,
  Network,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { upcomingDrills } from "@/entities/scenario";
import { fetchOverview, type PlatformOverview } from "@/shared/lib/liveClient";

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="overview-metric">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export default function HomeOverview() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await fetchOverview();
        if (active) {
          setOverview(next);
          setError(null);
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "Inventory unavailable",
          );
      }
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const observed = overview
    ? new Date(overview.observedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <main className="home-overview">
      <section className="overview-hero">
        <div className="overview-hero-copy" data-lab-reveal>
          <p className="kicker">
            <Activity size={15} /> A living Kubernetes homelab
          </p>
          <h1>
            Learn operations by <em>operating.</em>
          </h1>
          <p>
            This is the public control surface for a real three-node K3s
            platform. Explore its current state, launch an isolated practice
            workspace, or work an incident from symptom to recovery.
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="/practice">
              <Play size={17} fill="currentColor" /> Launch practice cluster
            </a>
            <a className="text-link" href="/topology">
              Open live topology <ArrowRight size={15} />
            </a>
          </div>
        </div>

        <aside className="overview-live-card" data-lab-reveal>
          <div className="overview-live-head">
            <span>
              <i className={overview?.cluster === "ready" ? "is-live" : ""} />
              CLUSTER / NOW
            </span>
            <small>{observed ? `observed ${observed}` : "connecting…"}</small>
          </div>
          {overview ? (
            <>
              <div className="overview-readiness">
                <strong>
                  {overview.nodesReady}/{overview.nodesTotal}
                </strong>
                <span>nodes ready</span>
              </div>
              <div className="overview-mini-grid">
                <span>
                  <b>{overview.workloadsReady}</b> / {overview.workloadsDesired}{" "}
                  replicas
                </span>
                <span>
                  <b>{overview.runningPods}</b> measured pods
                </span>
                <span>
                  <b>{overview.gitOpsHealthy}</b> / {overview.gitOpsTotal}{" "}
                  GitOps
                </span>
                <span>
                  <b>{overview.slotsAvailable}</b> sandbox slots
                </span>
              </div>
            </>
          ) : (
            <div className="overview-connecting">
              <RefreshCw size={20} className="spin" />
              <span>{error ?? "Reading the Kubernetes API…"}</span>
            </div>
          )}
          <p>
            Values are sampled through the Kubernetes API and metrics-server.
            They are not seeded or generated in the browser.
          </p>
        </aside>
      </section>

      <section className="overview-section" id="now">
        <div className="overview-heading">
          <div>
            <p className="kicker">
              <Server size={15} /> Observed platform
            </p>
            <h2>What the cluster is doing now.</h2>
          </div>
          <p>
            A sanitized aggregate—enough to understand health and capacity,
            without exposing hostnames, addresses, labels, or private service
            configuration.
          </p>
        </div>
        <div className="overview-metrics-grid">
          <Metric
            icon={<Cpu size={18} />}
            label="Cluster CPU"
            value={overview ? `${overview.cpuUtilizationPct}%` : "—"}
            detail="usage ÷ allocatable CPU"
          />
          <Metric
            icon={<MemoryStick size={18} />}
            label="Cluster memory"
            value={overview ? `${overview.memoryUtilizationPct}%` : "—"}
            detail="usage ÷ allocatable memory"
          />
          <Metric
            icon={<Boxes size={18} />}
            label="Workload readiness"
            value={
              overview
                ? `${overview.workloadsReady}/${overview.workloadsDesired}`
                : "—"
            }
            detail="controller replicas available"
          />
          <Metric
            icon={<GitPullRequest size={18} />}
            label="GitOps health"
            value={
              overview
                ? `${overview.gitOpsHealthy}/${overview.gitOpsTotal}`
                : "—"
            }
            detail="applications synced and healthy"
          />
        </div>
      </section>

      <section className="overview-section overview-paths">
        <div className="overview-heading">
          <div>
            <p className="kicker">
              <Waypoints size={15} /> Choose your depth
            </p>
            <h2>Explore it. Change it. Recover it.</h2>
          </div>
        </div>
        <div className="path-grid">
          <a href="/topology">
            <Network size={22} />
            <small>01 / EXPLORE</small>
            <h3>Live homelab map</h3>
            <p>
              Move through the platform in 3D, select a component, and inspect
              its current replicas, resource use, and GitOps state.
            </p>
            <span>
              View topology <ArrowRight size={15} />
            </span>
          </a>
          <a href="/practice">
            <Boxes size={22} />
            <small>02 / PRACTICE</small>
            <h3>Disposable cluster workspace</h3>
            <p>
              Bring up a real isolated stack. Scale it, deploy the regressed
              release, turn on load, move it, restart it, and reset it.
            </p>
            <span>
              Start a workspace <ArrowRight size={15} />
            </span>
          </a>
          <a href="/drills">
            <ShieldCheck size={22} />
            <small>03 / RESPOND</small>
            <h3>Guided incidents</h3>
            <p>
              Diagnose failure from measured requests and spans, make a real
              intervention, and receive an evidence-backed outcome.
            </p>
            <span>
              Enter the drills <ArrowRight size={15} />
            </span>
          </a>
        </div>
      </section>

      <section className="overview-section" id="scenarios">
        <div className="overview-heading">
          <div>
            <p className="kicker">
              <Activity size={15} /> Scenario catalogue
            </p>
            <h2>Failure is the curriculum.</h2>
          </div>
          <p>
            Each drill provisions real disposable resources, applies a bounded
            failure, captures real evidence, and tears itself down.
          </p>
        </div>
        <div className="scenario-preview-grid">
          {upcomingDrills
            .filter((item) => item.id !== "practice-cluster")
            .map((item, index) => (
              <a href={`/drills?scenario=${item.id}`} key={item.id}>
                <span>0{index + 1}</span>
                <small>{item.tag}</small>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <i>
                  Run drill <ArrowRight size={14} />
                </i>
              </a>
            ))}
        </div>
      </section>
    </main>
  );
}
