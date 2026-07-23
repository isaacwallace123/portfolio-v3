# checkout-demo — tiny real three-tier service for the HomeOps arena. Deps are resolved at build
# time so no go.sum needs committing for a single-file service.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY main.go .
RUN go mod init checkout-demo \
 && go get github.com/jackc/pgx/v5/pgxpool@v5.6.0 \
 && go get github.com/redis/go-redis/v9@v9.6.0 \
 && CGO_ENABLED=0 go build -ldflags="-s -w" -o /checkout .

FROM gcr.io/distroless/static:nonroot
COPY --from=build /checkout /checkout
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/checkout"]
