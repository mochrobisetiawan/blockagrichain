# Chaincode-as-a-Service (CCaaS) image — WAJIB untuk ECS Fargate.
# Peer tidak men-build/spawn chaincode; ia connect ke service ini via gRPC.
FROM golang:1.21-alpine AS build
WORKDIR /src
# go.* dulu agar layer dependency ter-cache.
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
# go mod tidy menyelesaikan versi exact (fabric-chaincode-go) saat build.
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /bin/chaincode .

FROM alpine:3.19
RUN adduser -D -u 10000 chaincode
USER chaincode
COPY --from=build /bin/chaincode /bin/chaincode
# CHAINCODE_ID & CHAINCODE_SERVER_ADDRESS di-inject via env (task definition Fargate).
ENV CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999
EXPOSE 9999
ENTRYPOINT ["/bin/chaincode"]
