#!/usr/bin/env bash
#
# network.sh — orkestrasi jaringan Fabric BlockAgriChain (Fabric 2.5, CCaaS).
# Dijalankan di host ber-Docker (EC2 Ubuntu / lokal Linux/WSL2) dengan binari
# Fabric (cryptogen, configtxgen, peer, osnadmin) pada PATH.
#
#   ./network.sh up        # crypto + genesis + naikkan kontainer + channel + chaincode
#   ./network.sh down       # hentikan & bersihkan
#   ./network.sh restart
#
# Prasyarat di host:
#   curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- binary docker
#   export PATH=$PWD/bin:$PATH
#   export FABRIC_CFG_PATH=$PWD/config        # berisi core.yaml dari install-fabric
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Perintah `peer`/`osnadmin` butuh core.yaml di FABRIC_CFG_PATH (default: fabric/config
# hasil install-fabric). `configtxgen` butuh configtx.yaml dan di-set INLINE ke $ROOT
# (lihat genGenesis/packageCC) agar tidak menimpa nilai ini.
export FABRIC_CFG_PATH="${FABRIC_CFG_PATH:-$ROOT/config}"

CHANNEL="blockagri"
CC_NAME="blockagri"
CC_LABEL="blockagri_1.0"
CC_SEQUENCE=1
CC_ADDRESS="chaincode.blockagri.id:9999"
COMPOSE="compose/compose-net.yaml"

ORDERER_HOST="orderer.blockagri.id"
ORDERER_CA="${ROOT}/organizations/ordererOrganizations/blockagri.id/tlsca/tlsca.blockagri.id-cert.pem"
ORDERER_ADMIN_TLS_SIGN_CERT="${ROOT}/organizations/ordererOrganizations/blockagri.id/orderers/orderer.blockagri.id/tls/server.crt"
ORDERER_ADMIN_TLS_PRIVATE_KEY="${ROOT}/organizations/ordererOrganizations/blockagri.id/orderers/orderer.blockagri.id/tls/server.key"

# Org → "MSPID:PORT"
declare -A ORG=(
  [petani]="PetaniMSP:7051"
  [bulog]="BulogMSP:8051"
  [kementan]="KementanMSP:9051"
  [kemenkeu]="KemenkeuMSP:10051"
  [pihc]="PIHCMSP:11051"
)
ORG_ORDER=(petani bulog kementan kemenkeu pihc)

# Endorsement policy: cukup SATU org menandatangani (any-of). Akses peran (RBAC)
# tetap ditegakkan di chaincode berdasarkan MSP PENGIRIM transaksi, bukan endorser,
# jadi kebijakan permisif ini tidak melemahkan kontrol akses. Bisa diperketat nanti.
CC_POLICY="OR('PetaniMSP.peer','BulogMSP.peer','KementanMSP.peer','KemenkeuMSP.peer','PIHCMSP.peer')"

setGlobals() {
  local org=$1
  local mspid="${ORG[$org]%%:*}"
  local port="${ORG[$org]##*:}"
  local domain="${org}.blockagri.id"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="$mspid"
  export CORE_PEER_TLS_ROOTCERT_FILE="${ROOT}/organizations/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${ROOT}/organizations/peerOrganizations/${domain}/users/Admin@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"
}

cryptoGen() {
  echo "==> Membangkitkan materi kripto (cryptogen)"
  rm -rf organizations
  cryptogen generate --config=crypto-config.yaml --output=organizations
  # Backend (container non-root, uid 10001) me-mount organizations:ro dan perlu BACA
  # identitas (priv_sk dll). cryptogen membuat key mode 600 milik root → beri izin baca.
  chmod -R a+rX organizations
}

genGenesis() {
  echo "==> Membangkitkan genesis block channel '${CHANNEL}'"
  mkdir -p channel-artifacts
  FABRIC_CFG_PATH="$ROOT" configtxgen -profile BlockAgriChannel -channelID "$CHANNEL" \
    -outputBlock "./channel-artifacts/${CHANNEL}.block"
}

networkUp() {
  echo "==> Menaikkan kontainer Fabric"
  CHAINCODE_ID="" docker compose -f "$COMPOSE" up -d \
    couchdb0 couchdb1 couchdb2 couchdb3 couchdb4 \
    orderer.blockagri.id \
    peer0.petani.blockagri.id peer0.bulog.blockagri.id peer0.kementan.blockagri.id \
    peer0.kemenkeu.blockagri.id peer0.pihc.blockagri.id
  sleep 8
}

createChannel() {
  echo "==> Membuat channel '${CHANNEL}' via osnadmin (channel participation)"
  osnadmin channel join --channelID "$CHANNEL" \
    --config-block "./channel-artifacts/${CHANNEL}.block" \
    -o localhost:7053 --ca-file "$ORDERER_CA" \
    --client-cert "$ORDERER_ADMIN_TLS_SIGN_CERT" \
    --client-key "$ORDERER_ADMIN_TLS_PRIVATE_KEY"
  sleep 3

  for org in "${ORG_ORDER[@]}"; do
    echo "    - peer org ${org} join channel"
    setGlobals "$org"
    peer channel join -b "./channel-artifacts/${CHANNEL}.block"
    sleep 2
  done
}

packageCC() {
  echo "==> Mengemas chaincode (tipe ccaas) → ${CC_NAME}.tar.gz"
  ( cd chaincode-package
    tar czf code.tar.gz connection.json
    tar czf "../${CC_NAME}.tar.gz" metadata.json code.tar.gz
    rm -f code.tar.gz )
  PKG_ID=$(peer lifecycle chaincode calculatepackageid "${CC_NAME}.tar.gz")
  echo "    Package ID = ${PKG_ID}"
  echo "$PKG_ID" > .ccpackageid
}

installApproveCommit() {
  local pkgid; pkgid=$(cat .ccpackageid)

  for org in "${ORG_ORDER[@]}"; do
    echo "==> Install chaincode di org ${org}"
    setGlobals "$org"
    peer lifecycle chaincode install "${CC_NAME}.tar.gz" || true
  done

  for org in "${ORG_ORDER[@]}"; do
    echo "==> Approve chaincode untuk org ${org}"
    setGlobals "$org"
    peer lifecycle chaincode approveformyorg \
      -o localhost:7050 --ordererTLSHostnameOverride "$ORDERER_HOST" \
      --tls --cafile "$ORDERER_CA" \
      --channelID "$CHANNEL" --name "$CC_NAME" --version 1.0 \
      --package-id "$pkgid" --sequence "$CC_SEQUENCE" \
      --signature-policy "$CC_POLICY"
  done

  echo "==> Commit chaincode ke channel"
  setGlobals petani
  local peerArgs=""
  for org in "${ORG_ORDER[@]}"; do
    local domain="${org}.blockagri.id"
    local port="${ORG[$org]##*:}"
    peerArgs="$peerArgs --peerAddresses localhost:${port} --tlsRootCertFiles ${ROOT}/organizations/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
  done
  # shellcheck disable=SC2086
  peer lifecycle chaincode commit \
    -o localhost:7050 --ordererTLSHostnameOverride "$ORDERER_HOST" \
    --tls --cafile "$ORDERER_CA" \
    --channelID "$CHANNEL" --name "$CC_NAME" --version 1.0 \
    --sequence "$CC_SEQUENCE" --signature-policy "$CC_POLICY" \
    $peerArgs
}

ccaasUp() {
  local pkgid; pkgid=$(cat .ccpackageid)
  echo "==> Menjalankan service chaincode CCaaS (CHAINCODE_ID=${pkgid})"
  CHAINCODE_ID="$pkgid" docker compose -f "$COMPOSE" up -d --build chaincode.blockagri.id
}

up() {
  cryptoGen
  genGenesis
  networkUp
  createChannel
  packageCC
  ccaasUp          # chaincode harus hidup sebelum commit agar peer bisa konek
  installApproveCommit
  echo ""
  echo "✅ Jaringan BlockAgriChain SIAP. Channel='${CHANNEL}', chaincode='${CC_NAME}' (CCaaS)."
  echo "   Backend Go (backend-go/) kini bisa connect via Fabric Gateway ke localhost:7051."
}

down() {
  echo "==> Menurunkan jaringan & membersihkan"
  CHAINCODE_ID="" docker compose -f "$COMPOSE" down --volumes --remove-orphans || true
  rm -rf organizations channel-artifacts "${CC_NAME}.tar.gz" .ccpackageid
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  restart) down; up ;;
  *) echo "Pemakaian: $0 {up|down|restart}"; exit 1 ;;
esac
