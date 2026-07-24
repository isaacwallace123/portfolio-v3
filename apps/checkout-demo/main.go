// checkout-demo is the real, disposable request path used by the HomeOps drills.
//
// Every request produces OpenTelemetry spans. Scenario state is broker-controlled through a tiny
// set of environment variables rendered by Crossplane: a candidate release adds a real slow/erroring
// pricing path, a degraded data state adds real failed integrity checks, and stable/recovered states
// remove those faults on the next Kubernetes rollout.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

var (
	pool         *pgxpool.Pool
	rdb          *redis.Client
	cacheOn      bool
	dbMs         = envInt("DB_QUERY_MS", 25)
	releaseTrack = envString("RELEASE_TRACK", "stable")
	dataState    = envString("DATA_STATE", "healthy")
	requestCount atomic.Uint64
	traces       = newTraceStore()
	tracer       trace.Tracer
)

func main() {
	ctx := context.Background()
	provider := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(traces),
		sdktrace.WithResource(resource.NewSchemaless(
			attribute.String("service.name", "checkout"),
			attribute.String("service.version", releaseTrack),
		)),
	)
	defer func() { _ = provider.Shutdown(ctx) }()
	otel.SetTracerProvider(provider)
	tracer = provider.Tracer("homeops/checkout")

	cfg, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("bad DATABASE_URL: %v", err)
	}
	cfg.MaxConns = int32(envInt("DB_MAX_CONNS", 4))

	for i := 0; i < 30; i++ {
		pool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err == nil && pool.Ping(ctx) == nil {
			break
		}
		time.Sleep(2 * time.Second)
	}
	if err != nil || pool == nil {
		log.Fatalf("postgres unreachable: %v", err)
	}
	_, _ = pool.Exec(ctx,
		`CREATE TABLE IF NOT EXISTS catalogue (id serial primary key, name text, price int)`)
	_, _ = pool.Exec(ctx,
		`INSERT INTO catalogue (name, price)
		 SELECT 'item-'||g, (random()*100)::int FROM generate_series(1,200) g
		 WHERE NOT EXISTS (SELECT 1 FROM catalogue)`)

	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		rdb = redis.NewClient(&redis.Options{
			Addr:         addr,
			MaxRetries:   -1,
			DialTimeout:  200 * time.Millisecond,
			ReadTimeout:  200 * time.Millisecond,
			WriteTimeout: 200 * time.Millisecond,
		})
	}
	cacheOn = os.Getenv("CACHE_ENABLED") == "true"

	http.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	http.HandleFunc("/internal/traces/latest", handleLatestTrace)
	http.HandleFunc("/", handleCheckout)

	log.Printf(
		"checkout-demo listening on :8080 (release=%s data=%s dbMs=%d cache=%v)",
		releaseTrack, dataState, dbMs, cacheOn)
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handleCheckout(w http.ResponseWriter, r *http.Request) {
	ctx, root := tracer.Start(
		r.Context(),
		"checkout.request",
		trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(
			attribute.String("http.route", "/"),
			attribute.String("release.track", releaseTrack),
			attribute.String("data.state", dataState),
		),
	)
	defer root.End()

	sequence := requestCount.Add(1)
	if cacheOn && rdb != nil {
		cacheCtx, cacheSpan := tracer.Start(ctx, "redis.get",
			trace.WithAttributes(attribute.String("db.system", "redis")))
		val, err := rdb.Get(cacheCtx, "catalogue").Result()
		cacheSpan.End()
		if err == nil {
			w.Header().Set("X-Source", "cache")
			w.Header().Set("X-Release", releaseTrack)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(val))
			return
		}
	}

	dbCtx, dbSpan := tracer.Start(ctx, "postgres.query",
		trace.WithAttributes(attribute.String("db.system", "postgresql")))
	var count int
	err := pool.QueryRow(
		dbCtx,
		`SELECT count(*) FROM catalogue, pg_sleep($1)`,
		float64(dbMs)/1000.0,
	).Scan(&count)
	if err != nil {
		dbSpan.RecordError(err)
		dbSpan.SetStatus(codes.Error, "query failed")
		dbSpan.End()
		fail(root, w, http.StatusBadGateway, "database_query")
		return
	}
	dbSpan.End()

	if dataState == "degraded" && sequence%4 == 0 {
		_, integrity := tracer.Start(ctx, "catalogue.integrity",
			trace.WithAttributes(attribute.String("recovery.state", "degraded")))
		integrity.SetStatus(codes.Error, "catalogue generation mismatch")
		integrity.End()
		fail(root, w, http.StatusBadGateway, "catalogue_integrity")
		return
	}

	_, pricing := tracer.Start(ctx, "pricing.apply",
		trace.WithAttributes(attribute.String("release.track", releaseTrack)))
	if releaseTrack == "candidate" {
		time.Sleep(350 * time.Millisecond)
		if sequence%10 == 0 {
			pricing.SetStatus(codes.Error, "candidate pricing panic")
			pricing.End()
			fail(root, w, http.StatusInternalServerError, "pricing_regression")
			return
		}
	}
	pricing.End()

	body, _ := json.Marshal(map[string]any{
		"catalogue": count,
		"source":    "db",
		"release":   releaseTrack,
	})
	if cacheOn && rdb != nil {
		_ = rdb.Set(ctx, "catalogue", body, 10*time.Second).Err()
	}
	w.Header().Set("X-Source", "db")
	w.Header().Set("X-Release", releaseTrack)
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

func fail(span trace.Span, w http.ResponseWriter, status int, errorType string) {
	span.SetAttributes(attribute.String("error.type", errorType))
	span.SetStatus(codes.Error, errorType)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"checkout unavailable"}`))
}

func handleLatestTrace(w http.ResponseWriter, _ *http.Request) {
	latest, ok := traces.latest()
	if !ok {
		http.Error(w, `{"error":"no trace available"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(latest)
}

type spanView struct {
	SpanID       string            `json:"spanId"`
	ParentSpanID string            `json:"parentSpanId,omitempty"`
	Name         string            `json:"name"`
	Service      string            `json:"service"`
	DurationMs   int               `json:"durationMs"`
	Status       string            `json:"status"`
	Attributes   map[string]string `json:"attributes"`
}

type traceView struct {
	TraceID    string     `json:"traceId"`
	Release    string     `json:"release"`
	DurationMs int        `json:"durationMs"`
	CapturedAt time.Time  `json:"capturedAt"`
	Spans      []spanView `json:"spans"`
}

type traceStore struct {
	mu       sync.RWMutex
	partial  map[string][]spanView
	latestID string
	latestAt time.Time
}

func newTraceStore() *traceStore {
	return &traceStore{partial: make(map[string][]spanView)}
}

func (s *traceStore) ExportSpans(_ context.Context, spans []sdktrace.ReadOnlySpan) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, span := range spans {
		traceID := span.SpanContext().TraceID().String()
		attrs := make(map[string]string)
		for _, item := range span.Attributes() {
			switch string(item.Key) {
			case "http.route", "release.track", "data.state", "db.system", "recovery.state", "error.type":
				attrs[string(item.Key)] = item.Value.AsString()
			}
		}
		status := "ok"
		if span.Status().Code == codes.Error {
			status = "error"
		}
		parent := ""
		if span.Parent().SpanID().IsValid() {
			parent = span.Parent().SpanID().String()
		}
		s.partial[traceID] = append(s.partial[traceID], spanView{
			SpanID:       span.SpanContext().SpanID().String(),
			ParentSpanID: parent,
			Name:         span.Name(),
			Service:      "checkout",
			DurationMs:   max(1, int(span.EndTime().Sub(span.StartTime()).Milliseconds())),
			Status:       status,
			Attributes:   attrs,
		})
		if parent == "" {
			s.latestID = traceID
			s.latestAt = span.EndTime()
			for id := range s.partial {
				if id != traceID {
					delete(s.partial, id)
				}
			}
		}
	}
	return nil
}

func (s *traceStore) Shutdown(context.Context) error { return nil }

func (s *traceStore) latest() (traceView, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	spans, ok := s.partial[s.latestID]
	if !ok {
		return traceView{}, false
	}
	total := 0
	for _, span := range spans {
		if span.ParentSpanID == "" {
			total = span.DurationMs
			break
		}
	}
	copyOfSpans := append([]spanView(nil), spans...)
	return traceView{
		TraceID:    s.latestID,
		Release:    releaseTrack,
		DurationMs: total,
		CapturedAt: s.latestAt,
		Spans:      copyOfSpans,
	}, true
}

func envInt(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
