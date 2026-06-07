# Backend API (Go) — image stateless, cocok untuk ECS Fargate.
FROM golang:1.21-alpine AS build
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /bin/server ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
USER app
COPY --from=build /bin/server /bin/server
# Materi kripto Fabric di-mount read-only (EFS di Fargate / volume di compose) ke /fabric.
ENV FABRIC_CRYPTO_PATH=/fabric/organizations
EXPOSE 8080
ENTRYPOINT ["/bin/server"]
