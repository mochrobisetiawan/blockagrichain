#!/usr/bin/env bash
# Build & push seluruh image BlockAgriChain ke Amazon ECR.
#   AWS_REGION=ap-southeast-3 AWS_ACCOUNT=123456789012 ./push-ecr.sh
set -euo pipefail

: "${AWS_REGION:?set AWS_REGION}"
: "${AWS_ACCOUNT:?set AWS_ACCOUNT}"
REG="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REPOS=(blockagri/chaincode blockagri/backend blockagri/frontend)

echo "==> Login ECR ${REG}"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REG"

for repo in "${REPOS[@]}"; do
  aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$repo" --region "$AWS_REGION" >/dev/null
done

echo "==> Build & push chaincode"
docker build -t "$REG/blockagri/chaincode:latest" "$ROOT/chaincode"
docker push "$REG/blockagri/chaincode:latest"

echo "==> Build & push backend (Go)"
docker build -t "$REG/blockagri/backend:latest" "$ROOT/backend-go"
docker push "$REG/blockagri/backend:latest"

echo "==> Build & push frontend"
docker build -t "$REG/blockagri/frontend:latest" "$ROOT/frontend"
docker push "$REG/blockagri/frontend:latest"

echo "✅ Selesai. Image tersedia di ${REG}/blockagri/*"
