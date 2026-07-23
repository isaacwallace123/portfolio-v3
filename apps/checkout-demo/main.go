// checkout-demo — a deliberately real three-tier request path for the HomeOps arena.
//
// GET / does actual work: on a cache miss it runs a real Postgres query that holds a connection for
// a fixed time (pg_sleep), so with a small connection pool the service saturates under load and p95
// latency climbs — exactly the incident the arena dramatises, except measured, not modelled. The two
// operator decisions relieve it for real: scaling adds replicas (more pooled connections → higher
// throughput → lower latency), and the cache serves from Redis (skips the DB entirely). Envoy sits in
// front and is the metrics source; this app just needs to have honest, load-dependent behaviour.
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var (
	pool    *pgxpool.Pool
	rdb     *redis.Client
	cacheOn bool
	dbMs    = envInt("DB_QUERY_MS", 25) // per-request DB work, ms
)

func main() {
	ctx := context.Background()

	cfg, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("bad DATABASE_URL: %v", err)
	}
	// A small pool per replica is the whole point: it makes the DB tier the bottleneck under load, so
	// adding replicas (the scale decision) measurably raises throughput.
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
		// No retries + short timeouts: when the cache tier is scaled to zero, a miss must fail fast
		// and fall through to the DB, never adding latency of its own.
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
	http.HandleFunc("/", handle)

	log.Printf("checkout-demo listening on :8080 (dbMs=%d, cache=%v)", dbMs, cacheOn)
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func handle(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	if cacheOn && rdb != nil {
		if val, err := rdb.Get(ctx, "catalogue").Result(); err == nil {
			w.Header().Set("X-Source", "cache")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(val))
			return
		}
	}

	// Real DB work that holds a pooled connection for dbMs; under load these queue. pg_sleep in the
	// FROM clause runs once and holds the connection, while count(*) returns real catalogue rows.
	var count int
	err := pool.QueryRow(ctx,
		`SELECT count(*) FROM catalogue, pg_sleep($1)`,
		float64(dbMs)/1000.0).Scan(&count)
	if err != nil {
		http.Error(w, `{"error":"checkout unavailable"}`, http.StatusBadGateway)
		return
	}

	body, _ := json.Marshal(map[string]any{"catalogue": count, "source": "db"})
	if cacheOn && rdb != nil {
		_ = rdb.Set(ctx, "catalogue", body, 10*time.Second).Err()
	}
	w.Header().Set("X-Source", "db")
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
