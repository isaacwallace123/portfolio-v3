# checkout-demo — tiny real three-tier service for the HomeOps arena. Deps are resolved at build
# time so no go.sum needs committing for a single-file service.
FROM golang:1.26-alpine@sha256:c95332c2af86b6d89b91bd0500f4b9529ccbd090a0d1855c6d1ceaa142ae8615 AS build
WORKDIR /src
COPY main.go .
RUN go mod init checkout-demo \
 && go get github.com/jackc/pgx/v5/pgxpool@v5.10.0 \
 && go get github.com/redis/go-redis/v9@v9.21.0 \
 && go get go.opentelemetry.io/otel@v1.44.0 \
 && go get go.opentelemetry.io/otel/sdk@v1.44.0 \
 && go get go.opentelemetry.io/otel/sdk/resource@v1.44.0 \
 && go get golang.org/x/text@v0.39.0 \
 && CGO_ENABLED=0 go build -ldflags="-s -w" -o /checkout .

FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6
COPY --from=build /checkout /checkout
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/checkout"]
