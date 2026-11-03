#!/usr/bin/env bash
# Sourced by web-e2e.sh. Existing local MinIO only; never a provider/prod endpoint.
[[ ${BB_E2E_STORAGE:-local} == minio ]] || return 0
export S3_ENDPOINT=${E2E_MINIO_ENDPOINT:-http://127.0.0.1:9000}
export S3_BUCKET=${E2E_MINIO_BUCKET:-beebeeb-test01}
# Validate the endpoint in the shell itself: scheme http, a loopback host, no
# userinfo, no path/query/fragment. Deliberately no python3 — the harness must
# run wherever bash does (task 2173: the bun test image has no python3, so a
# python3 check made the whole rung unrunnable there with exit 127).
_bb_reject() {
  echo "direct-storage-env.sh: $1" >&2
  return 1
}
_bb_rest=${S3_ENDPOINT#http://}
[ "$_bb_rest" != "$S3_ENDPOINT" ] || { _bb_reject 'MinIO rung requires a loopback http endpoint'; return 1; }
case "$_bb_rest" in
  *[\?\#[:space:]]*) _bb_reject 'MinIO rung requires a loopback http endpoint'; return 1 ;;
esac
_bb_authority=${_bb_rest%%/*}
[ "$_bb_authority" = "$_bb_rest" ] || { _bb_reject 'MinIO rung requires a loopback http endpoint'; return 1; }
case "$_bb_authority" in
  *@*) _bb_reject 'MinIO rung requires a loopback http endpoint'; return 1 ;;
  \[*\]:*) _bb_host="${_bb_authority%%]:*}]" ;;
  *) _bb_host=${_bb_authority%%:*} ;;
esac
case "$_bb_host" in
  127.0.0.1|localhost|'[::1]') ;;
  *) _bb_reject 'MinIO rung requires a loopback http endpoint'; return 1 ;;
esac
[ "$S3_BUCKET" = beebeeb-test01 ] || { _bb_reject 'MinIO rung requires the dedicated test bucket'; return 1; }
unset _bb_rest _bb_authority _bb_host
export S3_REGION=${E2E_MINIO_REGION:-eu-central-1}
# Public local-fixture values; no provider credentials are accepted by this variant.
export S3_ACCESS_KEY_ID=${E2E_MINIO_ACCESS_KEY_ID:-minioadmin}
export S3_SECRET_ACCESS_KEY=${E2E_MINIO_SECRET_ACCESS_KEY:-minioadmin}
export BB_DIRECT_DOWNLOAD=${BB_E2E_DIRECT_DOWNLOAD:-1} BB_DIRECT_UPLOAD=0 BB_DIRECT_TRANSFER_POOLS='*'
export BB_DIRECT_DISABLE=web:upload
export VITE_DEV_STORAGE_PAIR="{\"host\":\"${S3_ENDPOINT#http://}\",\"bucket\":\"$S3_BUCKET\"}"
E2E_STORAGE_ENV=(BLOB_STORE=s3)
